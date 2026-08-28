const {
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} = require("node:crypto");
const { HttpError } = require("../../lib/http-error");
const { sha256Canonical } = require("./operation-codec");

const PEER_AUTH_VERSION = 1;
const DEFAULT_ALLOWED_SKEW_MS = 5 * 60 * 1000;
const SIGNATURE_PATTERN = /^[a-f0-9]{64}$/;

class PeerAuthenticationService {
  constructor({
    repository,
    clusterService,
    clusterRepository,
    secretBox,
    now = () => Date.now(),
    allowedSkewMs = DEFAULT_ALLOWED_SKEW_MS
  }) {
    this.repository = repository;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.secretBox = secretBox;
    this.now = now;
    this.allowedSkewMs = allowedSkewMs;
  }

  issueCredential(userId, peerNodeId, sharedSecret = createSharedSecret()) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = this.clusterRepository.findNode(context.space_id, peerNodeId);
    if (!peer || peer.revoked_at !== null || peer.id === context.local_node_id) {
      throw new HttpError(400, "PEER_NODE_INVALID", "只能为已登记的对端 Hub 创建凭据。");
    }
    const secret = normalizeSharedSecret(sharedSecret);
    const existing = this.repository.find(context.space_id, peer.id);
    const now = this.now();
    const keyId = randomUUID();
    this.repository.save({
      spaceId: context.space_id,
      peerNodeId: peer.id,
      keyId,
      encryptedSharedSecret: this.secretBox.encrypt(secret.toString("base64")),
      createdAt: existing?.created_at ?? now,
      rotatedAt: existing ? now : null
    });
    return {
      spaceId: context.space_id,
      peerNodeId: peer.id,
      keyId,
      sharedSecret: secret.toString("base64")
    };
  }

  getCredential(userId, peerNodeId) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = this.clusterRepository.findNode(context.space_id, peerNodeId);
    const credential = this.repository.find(context.space_id, peerNodeId);
    if (
      !peer ||
      peer.revoked_at !== null ||
      peer.id === context.local_node_id ||
      !credential ||
      credential.revoked_at !== null
    ) {
      throw new HttpError(409, "PEER_CREDENTIAL_UNAVAILABLE", "对端 Hub 的签名凭据不可用。");
    }
    return {
      spaceId: context.space_id,
      peerNodeId: peer.id,
      keyId: credential.key_id,
      sharedSecret: decryptSharedSecret(
        this.secretBox,
        credential.encrypted_shared_secret
      ).toString("base64")
    };
  }

  importCredential(userId, peerNodeId, keyId, sharedSecret) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = this.clusterRepository.findNode(context.space_id, peerNodeId);
    if (!peer || peer.revoked_at !== null || peer.id === context.local_node_id) {
      throw new HttpError(400, "PEER_NODE_INVALID", "只能导入已登记对端 Hub 的凭据。");
    }
    const normalizedKeyId = String(keyId || "").trim();
    if (!/^[a-f0-9-]{36}$/i.test(normalizedKeyId)) {
      throw new HttpError(400, "PEER_KEY_ID_INVALID", "Peer 凭据 ID 无效。");
    }
    const secret = normalizeSharedSecret(sharedSecret);
    const existing = this.repository.find(context.space_id, peer.id);
    if (existing) {
      const currentSecret = decryptSharedSecret(
        this.secretBox,
        existing.encrypted_shared_secret
      );
      if (
        existing.key_id !== normalizedKeyId ||
        currentSecret.length !== secret.length ||
        !timingSafeEqual(currentSecret, secret)
      ) {
        throw new HttpError(409, "PEER_CREDENTIAL_MISMATCH", "本地已经保存了不同的 Peer 凭据。");
      }
      return { spaceId: context.space_id, peerNodeId: peer.id, keyId: existing.key_id };
    }
    const now = this.now();
    this.repository.save({
      spaceId: context.space_id,
      peerNodeId: peer.id,
      keyId: normalizedKeyId,
      encryptedSharedSecret: this.secretBox.encrypt(secret.toString("base64")),
      createdAt: now,
      rotatedAt: null
    });
    return { spaceId: context.space_id, peerNodeId: peer.id, keyId: normalizedKeyId };
  }

  createSignedHeaders(userId, peerNodeId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = this.clusterRepository.findNode(context.space_id, peerNodeId);
    const credential = this.repository.find(context.space_id, peerNodeId);
    if (
      !peer ||
      peer.revoked_at !== null ||
      peer.id === context.local_node_id ||
      !credential ||
      credential.revoked_at !== null
    ) {
      throw new HttpError(409, "PEER_CREDENTIAL_UNAVAILABLE", "对端 Hub 的签名凭据不可用。");
    }
    const secret = decryptSharedSecret(this.secretBox, credential.encrypted_shared_secret);
    return createPeerRequestHeaders({
      spaceId: context.space_id,
      nodeId: context.local_node_id,
      keyId: credential.key_id,
      method: input.method,
      path: input.path,
      body: input.body ?? {}
    }, secret);
  }

  verify(userId, input) {
    const context = this.clusterService.ensureSpace(userId);
    return this.verifyContext(context, input);
  }

  verifyBySpace(input) {
    const headers = normalizeHeaders(input?.headers);
    const spaceId = requiredHeader(headers, "x-aetherx-peer-space");
    const context = this.clusterRepository.findContextBySpaceId(spaceId);
    if (!context) {
      throw new HttpError(401, "PEER_AUTH_INVALID", "Peer 数据空间凭据无效。");
    }
    return this.verifyContext(context, input);
  }

  verifyContext(context, input) {
    const headers = normalizeHeaders(input?.headers);
    const signedSpaceId = requiredHeader(headers, "x-aetherx-peer-space");
    if (signedSpaceId !== context.space_id) {
      throw new HttpError(401, "PEER_AUTH_INVALID", "Peer 数据空间凭据无效。");
    }
    const peerNodeId = requiredHeader(headers, "x-aetherx-peer-node");
    const keyId = requiredHeader(headers, "x-aetherx-peer-key");
    const nonce = normalizeNonce(requiredHeader(headers, "x-aetherx-peer-nonce"));
    const requestTimestamp = normalizeTimestamp(
      requiredHeader(headers, "x-aetherx-peer-timestamp")
    );
    const signature = String(requiredHeader(headers, "x-aetherx-peer-signature")).toLowerCase();
    const now = this.now();
    if (Math.abs(now - requestTimestamp) > this.allowedSkewMs) {
      throw new HttpError(401, "PEER_REQUEST_EXPIRED", "Peer 请求时间戳已经失效。");
    }
    const peer = this.clusterRepository.findNode(context.space_id, peerNodeId);
    const credential = this.repository.find(context.space_id, peerNodeId);
    if (
      !peer ||
      peer.revoked_at !== null ||
      peer.id === context.local_node_id ||
      !credential ||
      credential.revoked_at !== null ||
      credential.key_id !== keyId
    ) {
      throw new HttpError(401, "PEER_AUTH_INVALID", "Peer 节点凭据无效。");
    }
    const secret = decryptSharedSecret(this.secretBox, credential.encrypted_shared_secret);
    const expected = signPeerRequest({
      spaceId: context.space_id,
      nodeId: peerNodeId,
      keyId,
      method: input.method,
      path: input.path,
      timestamp: requestTimestamp,
      nonce,
      body: input.body
    }, secret);
    if (!safeSignatureEqual(signature, expected)) {
      throw new HttpError(401, "PEER_AUTH_INVALID", "Peer 请求签名无效。");
    }
    this.repository.transaction(() => {
      this.repository.deleteExpiredNonces(now - this.allowedSkewMs * 2);
      if (this.repository.findNonce(context.space_id, peerNodeId, nonce)) {
        throw new HttpError(409, "PEER_REQUEST_REPLAYED", "Peer 请求不能重复使用相同随机数。");
      }
      this.repository.saveNonce({
        spaceId: context.space_id,
        peerNodeId,
        nonce,
        requestTimestamp,
        seenAt: now
      });
    });
    this.clusterRepository.touchNode(context.space_id, peerNodeId, now);
    return {
      userId: context.local_user_id,
      spaceId: context.space_id,
      peerNodeId,
      keyId
    };
  }
}

function createPeerRequestHeaders(input, sharedSecret) {
  const timestamp = Number(input.timestamp ?? Date.now());
  const nonce = normalizeNonce(input.nonce || randomUUID());
  return {
    "X-AetherX-Peer-Space": input.spaceId,
    "X-AetherX-Peer-Node": input.nodeId,
    "X-AetherX-Peer-Key": input.keyId,
    "X-AetherX-Peer-Timestamp": String(timestamp),
    "X-AetherX-Peer-Nonce": nonce,
    "X-AetherX-Peer-Signature": signPeerRequest({ ...input, timestamp, nonce }, sharedSecret)
  };
}

function signPeerRequest(input, sharedSecret) {
  const secret = normalizeSharedSecret(sharedSecret);
  const material = {
    version: PEER_AUTH_VERSION,
    spaceId: String(input.spaceId || ""),
    nodeId: String(input.nodeId || ""),
    keyId: String(input.keyId || ""),
    method: String(input.method || "").toUpperCase(),
    path: String(input.path || ""),
    timestamp: Number(input.timestamp),
    nonce: String(input.nonce || ""),
    bodyHash: sha256Canonical(input.body ?? {})
  };
  return createHmac("sha256", secret)
    .update(sha256Canonical(material), "utf8")
    .digest("hex");
}

function createSharedSecret() {
  return randomBytes(32).toString("base64");
}

function normalizeSharedSecret(value) {
  const secret = Buffer.isBuffer(value)
    ? Buffer.from(value)
    : Buffer.from(String(value || ""), "base64");
  if (secret.length !== 32) {
    throw new HttpError(400, "PEER_SECRET_INVALID", "Peer 共享密钥必须是 32 字节。");
  }
  return secret;
}

function decryptSharedSecret(secretBox, encrypted) {
  const value = secretBox.decrypt(encrypted);
  if (!value) throw new HttpError(500, "PEER_SECRET_UNAVAILABLE", "Peer 凭据无法解密。");
  return normalizeSharedSecret(value);
}

function normalizeHeaders(headers = {}) {
  return Object.fromEntries(
    Object.entries(headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)])
  );
}

function requiredHeader(headers, name) {
  const value = String(headers[name] || "").trim();
  if (!value) throw new HttpError(401, "PEER_AUTH_REQUIRED", "Peer 请求缺少认证信息。");
  return value;
}

function normalizeNonce(value) {
  const nonce = String(value || "").trim();
  if (!/^[A-Za-z0-9:_-]{16,200}$/.test(nonce)) {
    throw new HttpError(400, "PEER_NONCE_INVALID", "Peer 请求随机数格式无效。");
  }
  return nonce;
}

function normalizeTimestamp(value) {
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new HttpError(400, "PEER_TIMESTAMP_INVALID", "Peer 请求时间戳无效。");
  }
  return timestamp;
}

function safeSignatureEqual(left, right) {
  return SIGNATURE_PATTERN.test(left) &&
    SIGNATURE_PATTERN.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

module.exports = {
  createPeerRequestHeaders,
  createSharedSecret,
  DEFAULT_ALLOWED_SKEW_MS,
  PeerAuthenticationService,
  signPeerRequest
};
