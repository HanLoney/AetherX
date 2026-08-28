const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  sign,
  verify
} = require("node:crypto");
const { HttpError } = require("../../lib/http-error");
const { canonicalStringify, sha256Canonical } = require("../replication/operation-codec");
const { CLUSTER_PROTOCOL_VERSION } = require("../hub-cluster/cluster-service");

const DEFAULT_TTL_SECONDS = 180;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 600;
const WRAP_ALGORITHM = "X25519+HKDF-SHA256+A256GCM";
const WRAP_INFO = Buffer.from("aetherx-hub-pairing-v1", "utf8");

class HubPairingService {
  constructor({
    repository,
    clusterService,
    clusterRepository,
    endpointRepository,
    peerAuthenticationService,
    spaceKeyService,
    secretBox,
    now = () => Date.now()
  }) {
    this.repository = repository;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.endpointRepository = endpointRepository;
    this.peerAuthenticationService = peerAuthenticationService;
    this.spaceKeyService = spaceKeyService;
    this.secretBox = secretBox;
    this.now = now;
  }

  create(userId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    assertLocalActive(context);
    const now = this.now();
    const ttlSeconds = clampInteger(
      input.ttlSeconds,
      MIN_TTL_SECONDS,
      MAX_TTL_SECONDS,
      DEFAULT_TTL_SECONDS
    );
    const secret = randomBytes(32).toString("base64url");
    const ephemeral = generateKeyPairSync("x25519");
    const serverEphemeralPublicKey = exportPublicKey(ephemeral.publicKey);
    const encryptedServerEphemeralPrivateKey = this.secretBox.encrypt(
      exportPrivateKey(ephemeral.privateKey)
    );
    const endpoints = normalizeEndpoints(input.endpoints);
    const id = randomUUID();
    this.repository.deleteExpired(now);
    const session = this.repository.create({
      id,
      userId,
      spaceId: context.space_id,
      secretHash: hashSecret(secret),
      serverEphemeralPublicKey,
      encryptedServerEphemeralPrivateKey,
      sourceEndpoints: endpoints,
      createdAt: now,
      expiresAt: now + ttlSeconds * 1000
    });
    return {
      ...presentSession(session),
      secret,
      qrPayload: this.pairingPayload(session, secret, context)
    };
  }

  resolve(id, input = {}) {
    const secret = String(input.secret || "");
    const session = this.requireBySecret(id, requireSecret(secret));
    assertNotExpired(session, this.now());
    return this.pairingPayload(session, secret);
  }

  reuse(id, input = {}) {
    const secretHash = requireSecret(input.secret);
    const nodeId = normalizeNodeId(input.nodeId);
    const clientEphemeralPublicKey = normalizeX25519PublicKey(input.clientEphemeralPublicKey);
    return this.repository.transaction(() => {
      const session = this.requireBySecret(id, secretHash);
      assertNotExpired(session, this.now());
      const context = this.clusterService.ensureSpace(session.user_id);
      assertLocalActive(context);
      if (context.space_id !== session.space_id) {
        throw new HttpError(409, "HUB_PAIRING_SPACE_MISMATCH", "配对数据空间已经变化。");
      }
      const node = this.clusterRepository.findNode(context.space_id, nodeId);
      if (!node || node.revoked_at !== null || node.status === "revoked") {
        throw new HttpError(
          409,
          "HUB_NODE_NOT_REUSABLE",
          "手机 Hub 尚未登记或已经撤销，无法复用这个节点。"
        );
      }
      if (
        session.status === "redeemed" &&
        (session.requested_node_id !== nodeId ||
          session.client_ephemeral_public_key !== clientEphemeralPublicKey)
      ) {
        throw stateConflict();
      }
      if (!['created', 'redeemed'].includes(session.status)) throw stateConflict();

      const envelopeSession = {
        ...session,
        requested_node_id: nodeId,
        client_ephemeral_public_key: clientEphemeralPublicKey
      };
      const credential = session.status === "redeemed"
        ? this.peerAuthenticationService.getCredential(session.user_id, nodeId)
        : this.peerAuthenticationService.issueCredential(session.user_id, nodeId);
      const spaceKey = this.spaceKeyService.ensure(context.space_id);
      const envelope = this.wrapSecrets(envelopeSession, context, credential, spaceKey);
      if (session.status === "created") {
        const reusedAt = this.now();
        if (!this.repository.markReused({
          id,
          secretHash,
          nodeId,
          nodeName: node.node_name,
          platform: node.platform,
          publicIdentity: node.public_identity,
          protocolVersion: Number(node.protocol_version),
          schemaVersion: Number(node.schema_version),
          clientEphemeralPublicKey,
          reusedAt
        })) {
          throw stateConflict();
        }
      }
      return {
        ...presentSession(this.repository.findForUser(session.user_id, id)),
        reused: true,
        sourceNodeId: context.local_node_id,
        envelope
      };
    });
  }

  pairingPayload(session, secret, context = this.clusterService.ensureSpace(session.user_id)) {
    if (context.space_id !== session.space_id) {
      throw new HttpError(409, "HUB_PAIRING_SPACE_MISMATCH", "配对数据空间已经变化。");
    }
    return {
      protocolVersion: CLUSTER_PROTOCOL_VERSION,
      schemaVersion: Number(context.schema_version),
      spaceId: context.space_id,
      sourceNodeId: context.local_node_id,
      sessionId: session.id,
      secret,
      serverEphemeralPublicKey: session.server_ephemeral_public_key,
      certificateFingerprint: fingerprint(session.server_ephemeral_public_key),
      endpoints: parseStoredEndpoints(session.source_endpoints_json),
      expiresAt: Number(session.expires_at)
    };
  }

  claim(id, input = {}) {
    const secretHash = requireSecret(input.secret);
    const session = this.requireBySecret(id, secretHash);
    assertNotExpired(session, this.now());
    const claim = {
      nodeId: normalizeNodeId(input.nodeId),
      nodeName: boundedText(input.nodeName, 120, "新的 AetherX Hub"),
      platform: boundedText(input.platform, 40, "unknown"),
      publicIdentity: normalizePublicIdentity(input.publicIdentity),
      clientEphemeralPublicKey: normalizeX25519PublicKey(input.clientEphemeralPublicKey),
      protocolVersion: positiveInteger(input.protocolVersion, "protocolVersion"),
      schemaVersion: positiveInteger(input.schemaVersion, "schemaVersion"),
      endpoints: normalizeEndpoints(input.endpoints)
    };
    verifyIdentityProof(session, claim, input.identityProof);
    const context = this.clusterService.ensureSpace(session.user_id);
    if (
      claim.nodeId === context.local_node_id ||
      this.clusterRepository.findNode(context.space_id, claim.nodeId)
    ) {
      throw new HttpError(409, "HUB_NODE_ALREADY_EXISTS", "这个 Hub 节点已经登记。");
    }
    if (claim.protocolVersion !== CLUSTER_PROTOCOL_VERSION) {
      throw new HttpError(409, "HUB_PAIRING_PROTOCOL_INCOMPATIBLE", "Hub 复制协议版本不兼容。");
    }
    if (claim.schemaVersion !== Number(context.schema_version)) {
      throw new HttpError(409, "HUB_PAIRING_SCHEMA_INCOMPATIBLE", "Hub 数据库版本不兼容。");
    }
    if (session.status === "created") {
      if (!this.repository.claim({
        id,
        secretHash,
        ...claim,
        claimedAt: this.now()
      })) {
        throw stateConflict();
      }
      return { status: "pending" };
    }
    if (session.status === "pending" && sameClaim(session, claim)) {
      return { status: "pending" };
    }
    throw stateConflict();
  }

  get(userId, id) {
    const session = this.repository.findForUser(userId, id);
    if (!session) throw notFound();
    return presentSession(session);
  }

  approve(userId, id) {
    const session = this.repository.findForUser(userId, id);
    if (!session) throw notFound();
    assertNotExpired(session, this.now());
    const context = this.clusterService.ensureSpace(userId);
    assertLocalActive(context);
    if (session.status === "approved") return presentSession(session);
    if (session.status !== "pending") throw stateConflict();
    if (!this.repository.approve(userId, id, this.now())) throw stateConflict();
    return presentSession(this.repository.findForUser(userId, id));
  }

  redeem(id, input = {}) {
    const secretHash = requireSecret(input.secret);
    return this.repository.transaction(() => {
      const session = this.requireBySecret(id, secretHash);
      assertNotExpired(session, this.now());
      if (session.status !== "approved") throw stateConflict();
      const context = this.clusterService.ensureSpace(session.user_id);
      assertLocalActive(context);
      if (context.space_id !== session.space_id) {
        throw new HttpError(409, "HUB_PAIRING_SPACE_MISMATCH", "配对数据空间已经变化。");
      }
      if (this.clusterRepository.findNode(context.space_id, session.requested_node_id)) {
        throw new HttpError(409, "HUB_NODE_ALREADY_EXISTS", "这个 Hub 节点已经登记。");
      }
      this.clusterRepository.createNode({
        id: session.requested_node_id,
        spaceId: context.space_id,
        nodeName: session.node_name,
        platform: session.platform,
        publicIdentity: session.public_identity,
        protocolVersion: Number(session.protocol_version),
        schemaVersion: Number(session.schema_version),
        status: "pairing",
        now: this.now()
      });
      this.endpointRepository.replaceNodeEndpoints(
        context.space_id,
        context.local_node_id,
        parseStoredEndpoints(session.source_endpoints_json),
        this.now()
      );
      this.endpointRepository.replaceNodeEndpoints(
        context.space_id,
        session.requested_node_id,
        parseStoredEndpoints(session.requested_endpoints_json),
        this.now()
      );
      const credential = this.peerAuthenticationService.issueCredential(
        session.user_id,
        session.requested_node_id
      );
      const spaceKey = this.spaceKeyService.ensure(context.space_id);
      const envelope = this.wrapSecrets(session, context, credential, spaceKey);
      if (!this.repository.markRedeemed(id, secretHash, this.now())) throw stateConflict();
      return {
        status: "redeemed",
        spaceId: context.space_id,
        nodeId: session.requested_node_id,
        sourceNodeId: context.local_node_id,
        envelope
      };
    });
  }

  wrapSecrets(session, context, credential, spaceKey) {
    const privateKeyValue = this.secretBox.decrypt(
      session.encrypted_server_ephemeral_private_key
    );
    if (!privateKeyValue) {
      throw new HttpError(500, "HUB_PAIRING_KEY_UNAVAILABLE", "Hub 配对临时密钥无法解密。");
    }
    const serverPrivateKey = importPrivateKey(privateKeyValue);
    const clientPublicKey = importPublicKey(session.client_ephemeral_public_key);
    const shared = diffieHellman({ privateKey: serverPrivateKey, publicKey: clientPublicKey });
    const aad = {
      sessionId: session.id,
      spaceId: context.space_id,
      sourceNodeId: context.local_node_id,
      nodeId: session.requested_node_id,
      serverEphemeralPublicKey: session.server_ephemeral_public_key,
      clientEphemeralPublicKey: session.client_ephemeral_public_key
    };
    const wrappingKey = deriveWrappingKey(shared, aad.sessionId);
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", wrappingKey, iv);
    const aadBytes = Buffer.from(canonicalStringify(aad), "utf8");
    cipher.setAAD(aadBytes);
    const payload = {
      protocolVersion: CLUSTER_PROTOCOL_VERSION,
      schemaVersion: Number(context.schema_version),
      spaceId: context.space_id,
      localNodeId: session.requested_node_id,
      peerNodeId: context.local_node_id,
      activeNodeId: context.active_node_id,
      epoch: Number(context.epoch),
      space: {
        id: context.space_id,
        displayName: context.display_name,
        createdAt: Number(context.space_created_at)
      },
      clusterState: {
        epoch: Number(context.epoch),
        activeNodeId: context.active_node_id,
        transitionId: context.transition_id,
        state: context.state,
        stateHash: context.state_hash,
        controlSignature: context.control_signature,
        updatedAt: Number(context.state_updated_at)
      },
      nodes: this.clusterRepository.listNodes(context.space_id).map((node) => ({
        id: node.id,
        name: node.node_name,
        platform: node.platform,
        publicIdentity: node.public_identity,
        protocolVersion: Number(node.protocol_version),
        schemaVersion: Number(node.schema_version),
        status: node.status,
        lastSeenAt: node.last_seen_at === null ? null : Number(node.last_seen_at),
        createdAt: Number(node.created_at),
        revokedAt: node.revoked_at === null ? null : Number(node.revoked_at)
      })),
      endpoints: this.endpointRepository.listForSpace(context.space_id).map((endpoint) => ({
        nodeId: endpoint.nodeId,
        transport: endpoint.transport,
        address: endpoint.address,
        priority: endpoint.priority,
        certificateFingerprint: endpoint.certificateFingerprint
      })),
      peerCredential: {
        keyId: credential.keyId,
        sharedSecret: credential.sharedSecret
      },
      spaceSyncKey: spaceKey.key.toString("base64"),
      spaceSyncKeyVersion: spaceKey.keyVersion,
      issuedAt: this.now()
    };
    const ciphertext = Buffer.concat([
      cipher.update(canonicalStringify(payload), "utf8"),
      cipher.final()
    ]);
    return {
      version: 1,
      algorithm: WRAP_ALGORITHM,
      aad,
      aadHash: sha256Canonical(aad),
      iv: iv.toString("base64"),
      authenticationTag: cipher.getAuthTag().toString("base64"),
      ciphertext: ciphertext.toString("base64")
    };
  }

  requireBySecret(id, secretHash) {
    const session = this.repository.findBySecret(id, secretHash);
    if (!session) throw new HttpError(404, "HUB_PAIRING_NOT_FOUND", "Hub 配对会话不存在或凭证无效。");
    return session;
  }
}

function unwrapHubPairingEnvelope(envelope, clientEphemeralPrivateKey) {
  if (envelope?.version !== 1 || envelope?.algorithm !== WRAP_ALGORITHM) {
    throw new HttpError(400, "HUB_PAIRING_ENVELOPE_INVALID", "Hub 配对密钥包格式无效。");
  }
  if (sha256Canonical(envelope.aad) !== envelope.aadHash) {
    throw new HttpError(400, "HUB_PAIRING_ENVELOPE_INVALID", "Hub 配对密钥包 AAD 校验失败。");
  }
  const privateKey = importPrivateKey(clientEphemeralPrivateKey);
  const serverPublicKey = importPublicKey(envelope.aad.serverEphemeralPublicKey);
  const shared = diffieHellman({ privateKey, publicKey: serverPublicKey });
  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveWrappingKey(shared, envelope.aad.sessionId),
    Buffer.from(envelope.iv, "base64")
  );
  decipher.setAAD(Buffer.from(canonicalStringify(envelope.aad), "utf8"));
  decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final()
  ]).toString("utf8"));
}

function generateClientEphemeralKeyPair() {
  const pair = generateKeyPairSync("x25519");
  return {
    publicKey: exportPublicKey(pair.publicKey),
    privateKey: exportPrivateKey(pair.privateKey)
  };
}

function generateClientIdentityKeyPair() {
  const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  return {
    publicKey: exportPublicKey(pair.publicKey),
    privateKey: exportPrivateKey(pair.privateKey)
  };
}

function signHubPairingClaim(input, clientIdentityPrivateKey) {
  const key = importIdentityPrivateKey(clientIdentityPrivateKey);
  return sign(
    "sha256",
    Buffer.from(canonicalStringify(claimProofMaterial(input)), "utf8"),
    key
  ).toString("base64");
}

function deriveWrappingKey(shared, sessionId) {
  return Buffer.from(hkdfSync(
    "sha256",
    shared,
    Buffer.from(String(sessionId), "utf8"),
    WRAP_INFO,
    32
  ));
}

function exportPublicKey(key) {
  return key.export({ type: "spki", format: "der" }).toString("base64");
}

function exportPrivateKey(key) {
  return key.export({ type: "pkcs8", format: "der" }).toString("base64");
}

function importPublicKey(value) {
  const key = createPublicKey({ key: Buffer.from(String(value), "base64"), type: "spki", format: "der" });
  if (key.asymmetricKeyType !== "x25519") throw invalidEphemeralKey();
  return key;
}

function importPrivateKey(value) {
  const key = createPrivateKey({ key: Buffer.from(String(value), "base64"), type: "pkcs8", format: "der" });
  if (key.asymmetricKeyType !== "x25519") throw invalidEphemeralKey();
  return key;
}

function normalizeX25519PublicKey(value) {
  try {
    return exportPublicKey(importPublicKey(value));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw invalidEphemeralKey();
  }
}

function invalidEphemeralKey() {
  return new HttpError(400, "HUB_PAIRING_EPHEMERAL_KEY_INVALID", "Hub 配对临时公钥无效。");
}

function normalizeNodeId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(id)) {
    throw new HttpError(400, "HUB_NODE_ID_INVALID", "Hub 节点 ID 格式无效。");
  }
  return id;
}

function normalizePublicIdentity(value) {
  try {
    const key = createPublicKey({
      key: Buffer.from(String(value || ""), "base64"),
      type: "spki",
      format: "der"
    });
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new Error("unsupported key");
    }
    return exportPublicKey(key);
  } catch {
    throw new HttpError(
      400,
      "HUB_PUBLIC_IDENTITY_INVALID",
      "Hub 节点身份必须使用 P-256 公钥。"
    );
  }
}

function importIdentityPrivateKey(value) {
  try {
    const key = createPrivateKey({
      key: Buffer.from(String(value || ""), "base64"),
      type: "pkcs8",
      format: "der"
    });
    if (
      key.asymmetricKeyType !== "ec" ||
      key.asymmetricKeyDetails?.namedCurve !== "prime256v1"
    ) {
      throw new Error("unsupported key");
    }
    return key;
  } catch {
    throw new HttpError(400, "HUB_PRIVATE_IDENTITY_INVALID", "Hub 节点身份私钥无效。");
  }
}

function verifyIdentityProof(session, claim, value) {
  let signature;
  try {
    signature = Buffer.from(String(value || ""), "base64");
  } catch {
    signature = Buffer.alloc(0);
  }
  const publicKey = createPublicKey({
    key: Buffer.from(claim.publicIdentity, "base64"),
    type: "spki",
    format: "der"
  });
  const valid = signature.length > 0 && verify(
    "sha256",
    Buffer.from(canonicalStringify(claimProofMaterial({
      sessionId: session.id,
      spaceId: session.space_id,
      ...claim
    })), "utf8"),
    publicKey,
    signature
  );
  if (!valid) {
    throw new HttpError(
      401,
      "HUB_IDENTITY_PROOF_INVALID",
      "新 Hub 未能证明它持有节点身份私钥。"
    );
  }
}

function claimProofMaterial(input) {
  return {
    version: 1,
    sessionId: String(input.sessionId || ""),
    spaceId: String(input.spaceId || ""),
    nodeId: String(input.nodeId || ""),
    nodeName: String(input.nodeName || ""),
    platform: String(input.platform || ""),
    publicIdentity: String(input.publicIdentity || ""),
    clientEphemeralPublicKey: String(input.clientEphemeralPublicKey || ""),
    protocolVersion: Number(input.protocolVersion),
    schemaVersion: Number(input.schemaVersion),
    endpoints: normalizeEndpoints(input.endpoints)
  };
}

function normalizeEndpoints(value) {
  if (!Array.isArray(value)) return [];
  const normalized = value.slice(0, 8).map((endpoint, index) => {
    const rawAddress = String(endpoint?.address || "").trim();
    const transport = String(endpoint?.transport || "").trim();
    let parsed;
    try {
      parsed = new URL(rawAddress);
    } catch {
      throw new HttpError(400, "HUB_ENDPOINT_INVALID", "Hub 候选连接地址无效。");
    }
    const protocolAllowed = transport === "lan"
      ? ["http:", "https:"].includes(parsed.protocol)
      : transport === "anywhere" && parsed.protocol === "https:";
    if (
      !protocolAllowed ||
      rawAddress.length > 500 ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      !["", "/"].includes(parsed.pathname)
    ) {
      throw new HttpError(400, "HUB_ENDPOINT_INVALID", "Hub 候选连接地址无效。");
    }
    const numericPriority = Number(endpoint?.priority);
    const priority = Number.isSafeInteger(numericPriority)
      ? Math.max(-1000, Math.min(1000, numericPriority))
      : (transport === "lan" ? 200 : 100) - index;
    return {
      transport,
      address: parsed.origin,
      priority,
      certificateFingerprint: String(endpoint?.certificateFingerprint || "").slice(0, 256)
    };
  });
  return [...new Map(normalized.map((endpoint) => [
    `${endpoint.transport}\u0000${endpoint.address}`,
    endpoint
  ])).values()];
}

function sameClaim(session, claim) {
  return session.requested_node_id === claim.nodeId &&
    session.node_name === claim.nodeName &&
    session.platform === claim.platform &&
    session.public_identity === claim.publicIdentity &&
    session.client_ephemeral_public_key === claim.clientEphemeralPublicKey &&
    Number(session.protocol_version) === claim.protocolVersion &&
    Number(session.schema_version) === claim.schemaVersion &&
    canonicalStringify(parseStoredEndpoints(session.requested_endpoints_json)) ===
      canonicalStringify(claim.endpoints);
}

function parseStoredEndpoints(value) {
  try {
    return normalizeEndpoints(JSON.parse(String(value || "[]")));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(500, "HUB_ENDPOINT_STORAGE_INVALID", "Hub 端点记录无法读取。");
  }
}

function presentSession(row) {
  return {
    id: row.id,
    spaceId: row.space_id,
    status: row.status,
    nodeId: row.requested_node_id || "",
    nodeName: row.node_name || "",
    platform: row.platform || "",
    publicIdentityFingerprint: row.public_identity ? fingerprint(row.public_identity) : "",
    protocolVersion: row.protocol_version === null ? null : Number(row.protocol_version),
    schemaVersion: row.schema_version === null ? null : Number(row.schema_version),
    expiresAt: Number(row.expires_at),
    createdAt: Number(row.created_at),
    claimedAt: row.claimed_at === null ? null : Number(row.claimed_at),
    approvedAt: row.approved_at === null ? null : Number(row.approved_at),
    redeemedAt: row.redeemed_at === null ? null : Number(row.redeemed_at)
  };
}

function boundedText(value, maximum, fallback) {
  const result = String(value || fallback || "").trim();
  if (!result || result.length > maximum) {
    throw new HttpError(400, "HUB_PAIRING_FIELD_INVALID", "Hub 配对字段无效。");
  }
  return result;
}

function positiveInteger(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    throw new HttpError(400, "HUB_PAIRING_FIELD_INVALID", `${field} 必须是正整数。`);
  }
  return result;
}

function requireSecret(value) {
  const secret = String(value || "");
  if (secret.length < 32 || secret.length > 256) {
    throw new HttpError(400, "HUB_PAIRING_SECRET_INVALID", "Hub 配对凭证无效。");
  }
  return hashSecret(secret);
}

function hashSecret(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function fingerprint(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

function assertNotExpired(session, now) {
  if (Number(session.expires_at) <= now) {
    throw new HttpError(410, "HUB_PAIRING_EXPIRED", "Hub 配对会话已经过期。");
  }
}

function assertLocalActive(context) {
  if (context.local_node_id === context.active_node_id && context.state === "stable") return;
  throw new HttpError(409, "HUB_NOT_ACTIVE", "只有当前活动 Hub 可以发起节点配对。");
}

function stateConflict() {
  return new HttpError(409, "HUB_PAIRING_STATE_CONFLICT", "Hub 配对会话当前状态不允许这个操作。");
}

function notFound() {
  return new HttpError(404, "HUB_PAIRING_NOT_FOUND", "Hub 配对会话不存在。");
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

module.exports = {
  generateClientEphemeralKeyPair,
  generateClientIdentityKeyPair,
  HubPairingService,
  normalizeHubEndpoints: normalizeEndpoints,
  signHubPairingClaim,
  unwrapHubPairingEnvelope,
  WRAP_ALGORITHM
};
