const {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} = require("node:crypto");
const { isIP } = require("node:net");
const { HttpError } = require("../../lib/http-error");
const { canonicalStringify, sha256Canonical } = require("../replication/operation-codec");

const DEFAULT_TTL_MS = 2 * 60 * 1000;
const SPACE_PROOF_PURPOSE = "aetherx-desktop-login-space-proof";
const CREDENTIAL_WRAP_PURPOSE = "aetherx-desktop-login-credential-v1";

class DesktopQrLoginService {
  constructor({
    authService,
    clusterRepository,
    endpointRepository,
    peerAuthenticationService = null,
    spaceKeyService = null,
    now = () => Date.now(),
    ttlMs = DEFAULT_TTL_MS
  }) {
    this.authService = authService;
    this.clusterRepository = clusterRepository;
    this.endpointRepository = endpointRepository;
    this.peerAuthenticationService = peerAuthenticationService;
    this.spaceKeyService = spaceKeyService;
    this.now = now;
    this.ttlMs = Math.max(30_000, Number(ttlMs) || DEFAULT_TTL_MS);
    this.challenges = new Map();
  }

  create(remoteAddress) {
    assertLoopback(remoteAddress);
    this.cleanup();
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const createdAt = this.now();
    const expiresAt = createdAt + this.ttlMs;
    this.challenges.set(id, {
      id,
      secretHash: hashSecret(secret),
      status: "pending",
      createdAt,
      expiresAt,
      result: null
    });
    return { id, secret, status: "pending", createdAt, expiresAt };
  }

  authorize({ userId, spaceId, peerNodeId, body, remoteAddress }) {
    const challenge = this.requireChallenge(body?.challengeId, body?.secret);
    if (
      !["pending", "credential_issued"].includes(challenge.status) ||
      (challenge.recoveredNodeId && challenge.recoveredNodeId !== peerNodeId)
    ) {
      throw new HttpError(409, "DESKTOP_LOGIN_ALREADY_AUTHORIZED", "这个电脑登录二维码已经使用。");
    }
    const context = this.clusterRepository.findContextByUserId(userId);
    const peer = context && this.clusterRepository.findNode(context.space_id, peerNodeId);
    if (
      !context ||
      context.space_id !== spaceId ||
      !peer ||
      peer.revoked_at !== null ||
      String(peer.platform || "").toLowerCase() !== "android"
    ) {
      throw new HttpError(403, "DESKTOP_LOGIN_MOBILE_HUB_REQUIRED", "只能由已配对的手机 Hub 授权电脑登录。");
    }

    return this.completeAuthorization({
      challenge,
      context,
      userId,
      peerNodeId,
      remoteAddress,
      mobilePort: body?.mobilePort
    });
  }

  authorizeWithSpaceProof({ body, remoteAddress }) {
    if (!this.peerAuthenticationService || !this.spaceKeyService) {
      throw new HttpError(503, "DESKTOP_LOGIN_RECOVERY_UNAVAILABLE", "电脑 Hub 暂时无法恢复手机凭据。");
    }
    const challenge = this.requireChallenge(body?.challengeId, body?.secret);
    const input = normalizeSpaceProofInput(body, challenge);
    const fingerprint = sha256Canonical(input);
    if (challenge.status !== "pending") {
      if (
        challenge.status === "credential_issued" &&
        challenge.spaceProofFingerprint === fingerprint &&
        challenge.phoneResult
      ) {
        return challenge.phoneResult;
      }
      throw new HttpError(409, "DESKTOP_LOGIN_ALREADY_AUTHORIZED", "这个电脑登录二维码已经使用。");
    }

    const context = this.clusterRepository.findContextBySpaceId(input.spaceId);
    const peer = context && this.clusterRepository.findNode(input.spaceId, input.nodeId);
    if (
      !context ||
      context.active_node_id !== input.nodeId ||
      !["stable", "forced_active"].includes(String(context.state || "")) ||
      !peer ||
      peer.revoked_at !== null ||
      String(peer.platform || "").toLowerCase() !== "android"
    ) {
      throw new HttpError(403, "DESKTOP_LOGIN_MOBILE_HUB_REQUIRED", "只能由当前活动的手机 Hub 授权电脑登录。");
    }

    const spaceKey = this.spaceKeyService.ensure(input.spaceId);
    const expectedProof = createDesktopLoginSpaceProof(input, spaceKey.key);
    if (!safeHexEqual(input.proof, expectedProof)) {
      throw new HttpError(401, "DESKTOP_LOGIN_SPACE_PROOF_INVALID", "手机 Hub 的数据空间证明无效。");
    }

    const credential = this.peerAuthenticationService.issueCredential(
      context.local_user_id,
      input.nodeId
    );
    const envelope = wrapCredential({
      challenge,
      context,
      nodeId: input.nodeId,
      credential,
      spaceKey: spaceKey.key,
      issuedAt: this.now()
    });
    const endpoint = mobileEndpoint(remoteAddress, input.mobilePort);
    if (endpoint) {
      this.endpointRepository.upsertNodeEndpoint(
        context.space_id,
        input.nodeId,
        endpoint,
        this.now()
      );
    }
    challenge.status = "credential_issued";
    challenge.recoveredNodeId = input.nodeId;
    challenge.spaceProofFingerprint = fingerprint;
    challenge.phoneResult = {
      authorized: false,
      challengeId: challenge.id,
      computerNodeId: context.local_node_id,
      activeNodeId: context.active_node_id,
      expiresAt: challenge.expiresAt,
      credentialRotated: true,
      envelope
    };
    return challenge.phoneResult;
  }

  completeAuthorization({ challenge, context, userId, peerNodeId, remoteAddress, mobilePort }) {
    const endpoint = mobileEndpoint(remoteAddress, mobilePort);
    if (endpoint) {
      this.endpointRepository.upsertNodeEndpoint(
        context.space_id,
        peerNodeId,
        endpoint,
        this.now()
      );
    }
    challenge.status = "authorized";
    challenge.result = {
      ...this.authService.createHandoffSession(userId),
      spaceId: context.space_id,
      localNodeId: context.local_node_id,
      activeNodeId: context.active_node_id,
      epoch: Number(context.epoch),
      mobileNodeId: peerNodeId,
      mobileEndpoint: endpoint?.address || ""
    };
    return {
      authorized: true,
      challengeId: challenge.id,
      computerNodeId: context.local_node_id,
      activeNodeId: context.active_node_id,
      expiresAt: challenge.expiresAt
    };
  }

  poll(id, secret, remoteAddress) {
    assertLoopback(remoteAddress);
    const challenge = this.requireChallenge(id, secret);
    if (["pending", "credential_issued"].includes(challenge.status)) {
      return { status: "pending", expiresAt: challenge.expiresAt };
    }
    this.challenges.delete(challenge.id);
    return {
      status: "authorized",
      expiresAt: challenge.expiresAt,
      ...challenge.result
    };
  }

  requireChallenge(id, secret) {
    const normalizedId = String(id || "").trim();
    const normalizedSecret = String(secret || "").trim();
    const challenge = this.challenges.get(normalizedId);
    if (!challenge || !safeHashEqual(challenge.secretHash, hashSecret(normalizedSecret))) {
      throw new HttpError(404, "DESKTOP_LOGIN_CHALLENGE_NOT_FOUND", "电脑登录二维码无效或已经失效。");
    }
    if (challenge.expiresAt <= this.now()) {
      this.challenges.delete(normalizedId);
      throw new HttpError(410, "DESKTOP_LOGIN_CHALLENGE_EXPIRED", "电脑登录二维码已经过期，请重新生成。");
    }
    this.cleanup();
    return challenge;
  }

  cleanup() {
    const now = this.now();
    for (const [id, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(id);
    }
  }
}

function normalizeSpaceProofInput(body, challenge) {
  const input = {
    version: 1,
    purpose: SPACE_PROOF_PURPOSE,
    challengeId: String(body?.challengeId || "").trim(),
    secretHash: createHash("sha256").update(String(body?.secret || "")).digest("hex"),
    expiresAt: Number(body?.expiresAt),
    spaceId: String(body?.spaceId || "").trim(),
    nodeId: String(body?.nodeId || "").trim(),
    mobilePort: Number(body?.mobilePort),
    nonce: String(body?.nonce || "").trim(),
    proof: String(body?.proof || "").trim().toLowerCase()
  };
  if (
    input.challengeId !== challenge.id ||
    input.expiresAt !== challenge.expiresAt ||
    !/^[a-f0-9-]{36}$/i.test(input.spaceId) ||
    !/^[A-Za-z0-9:_-]{8,200}$/.test(input.nodeId) ||
    !Number.isInteger(input.mobilePort) || input.mobilePort < 1024 || input.mobilePort > 65535 ||
    !/^[A-Za-z0-9:_-]{16,200}$/.test(input.nonce) ||
    !/^[a-f0-9]{64}$/.test(input.proof)
  ) {
    throw new HttpError(400, "DESKTOP_LOGIN_SPACE_PROOF_INVALID", "手机 Hub 的数据空间证明格式无效。");
  }
  return input;
}

function createDesktopLoginSpaceProof(input, spaceKey) {
  const material = { ...input };
  delete material.proof;
  return createHmac("sha256", spaceKey)
    .update(sha256Canonical(material), "utf8")
    .digest("hex");
}

function wrapCredential({ challenge, context, nodeId, credential, spaceKey, issuedAt }) {
  const aad = {
    version: 1,
    purpose: CREDENTIAL_WRAP_PURPOSE,
    challengeId: challenge.id,
    spaceId: context.space_id,
    mobileNodeId: nodeId,
    computerNodeId: context.local_node_id,
    keyId: credential.keyId
  };
  const payload = {
    peerCredential: {
      keyId: credential.keyId,
      sharedSecret: credential.sharedSecret
    },
    issuedAt
  };
  const key = createHmac("sha256", spaceKey)
    .update(`${CREDENTIAL_WRAP_PURPOSE}:${challenge.id}`, "utf8")
    .digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(canonicalStringify(aad), "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(canonicalStringify(payload), "utf8"),
    cipher.final()
  ]);
  return {
    version: 1,
    algorithm: "A256GCM",
    aad,
    aadHash: sha256Canonical(aad),
    iv: iv.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64")
  };
}

function mobileEndpoint(remoteAddress, portValue) {
  const host = normalizeRemoteAddress(remoteAddress);
  const port = Number(portValue);
  if (!host || !Number.isInteger(port) || port < 1024 || port > 65535) return null;
  const hostname = isIP(host) === 6 ? `[${host}]` : host;
  return {
    transport: "lan",
    address: `http://${hostname}:${port}`,
    priority: 700,
    certificateFingerprint: ""
  };
}

function assertLoopback(value) {
  const address = normalizeRemoteAddress(value);
  if (address !== "127.0.0.1" && address !== "::1") {
    throw new HttpError(403, "DESKTOP_LOGIN_LOCAL_ONLY", "电脑登录二维码只能由本机创建和领取。");
  }
}

function normalizeRemoteAddress(value) {
  const address = String(value || "").trim().replace(/^\[|\]$/g, "");
  return address.startsWith("::ffff:") ? address.slice(7) : address;
}

function hashSecret(value) {
  return createHash("sha256").update(String(value || "")).digest();
}

function safeHashEqual(left, right) {
  return Buffer.isBuffer(left) && Buffer.isBuffer(right) &&
    left.length === right.length && timingSafeEqual(left, right);
}

function safeHexEqual(left, right) {
  return /^[a-f0-9]{64}$/.test(left) &&
    /^[a-f0-9]{64}$/.test(right) &&
    timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

module.exports = {
  DEFAULT_TTL_MS,
  DesktopQrLoginService,
  createDesktopLoginSpaceProof,
  normalizeRemoteAddress
};
