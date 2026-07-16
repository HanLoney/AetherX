const { createHash, randomBytes } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");

const DEFAULT_PAIRING_TTL_SECONDS = 120;
const MIN_PAIRING_TTL_SECONDS = 60;
const MAX_PAIRING_TTL_SECONDS = 600;

class DeviceService {
  constructor(repository) {
    this.repository = repository;
  }

  createPairingSession(userId, input = {}) {
    const now = Date.now();
    const ttlSeconds = clampInteger(
      input.ttlSeconds,
      MIN_PAIRING_TTL_SECONDS,
      MAX_PAIRING_TTL_SECONDS,
      DEFAULT_PAIRING_TTL_SECONDS
    );
    const secret = randomBytes(32).toString("base64url");
    this.repository.deleteExpiredPairingSessions(now);
    const session = this.repository.createPairingSession({
      userId,
      secretHash: hashSecret(secret),
      now,
      expiresAt: now + ttlSeconds * 1000
    });
    return {
      ...presentPairingSession(session),
      secret
    };
  }

  claimPairingSession(id, input = {}) {
    const secretHash = requireSecret(input.secret);
    const session = this.requirePairingSessionBySecret(id, secretHash);
    assertNotExpired(session);
    const deviceName = normalizeDeviceName(input.deviceName);
    const publicKey = normalizePublicKey(input.publicKey);

    if (session.status === "created") {
      if (
        !this.repository.claimPairingSession({
          id,
          secretHash,
          deviceName,
          publicKey
        })
      ) {
        throw pairingStateConflict();
      }
      return { status: "pending" };
    }
    if (
      session.status === "pending" &&
      session.device_name === deviceName &&
      session.public_key === publicKey
    ) {
      return { status: "pending" };
    }
    throw pairingStateConflict();
  }

  getPairingSession(userId, id) {
    const session = this.repository.findPairingSessionForUser(userId, id);
    if (!session) {
      throw new HttpError(404, "PAIRING_SESSION_NOT_FOUND", "配对会话不存在。");
    }
    return presentPairingSession(session);
  }

  approvePairingSession(userId, id) {
    const session = this.repository.findPairingSessionForUser(userId, id);
    if (!session) {
      throw new HttpError(404, "PAIRING_SESSION_NOT_FOUND", "配对会话不存在。");
    }
    assertNotExpired(session);
    if (session.status === "approved") return presentPairingSession(session);
    if (session.status !== "pending") throw pairingStateConflict();
    if (!this.repository.approvePairingSession(userId, id, Date.now())) {
      throw pairingStateConflict();
    }
    return presentPairingSession(
      this.repository.findPairingSessionForUser(userId, id)
    );
  }

  redeemPairingSession(id, input = {}) {
    const secretHash = requireSecret(input.secret);
    return this.repository.transaction(() => {
      const session = this.requirePairingSessionBySecret(id, secretHash);
      assertNotExpired(session);
      if (session.status !== "approved") throw pairingStateConflict();

      const token = randomBytes(32).toString("base64url");
      const now = Date.now();
      const device = this.repository.createDevice({
        userId: session.user_id,
        name: session.device_name,
        publicKey: session.public_key,
        tokenHash: hashSecret(token),
        now
      });
      if (
        !this.repository.markPairingSessionRedeemed(
          id,
          secretHash,
          device.id,
          now
        )
      ) {
        throw pairingStateConflict();
      }
      return { token, device: presentDevice(device) };
    });
  }

  listDevices(userId) {
    return this.repository.listDevices(userId).map(presentDevice);
  }

  revokeDevice(userId, id) {
    const device = this.repository.findDevice(userId, id);
    if (!device) {
      throw new HttpError(404, "DEVICE_NOT_FOUND", "设备不存在。");
    }
    if (device.status !== "revoked") {
      this.repository.revokeDevice(userId, id, Date.now());
    }
  }

  requirePairingSessionBySecret(id, secretHash) {
    const session = this.repository.findPairingSessionBySecret(id, secretHash);
    if (!session) {
      throw new HttpError(404, "PAIRING_SESSION_NOT_FOUND", "配对会话不存在或凭证无效。");
    }
    return session;
  }
}

function presentPairingSession(row) {
  return {
    id: row.id,
    status: row.status,
    deviceName: row.device_name || "",
    publicKey: row.public_key || "",
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    approvedAt: row.approved_at || null,
    redeemedAt: row.redeemed_at || null,
    deviceId: row.device_id || null
  };
}

function presentDevice(row) {
  return {
    id: row.id,
    name: row.name,
    publicKey: row.public_key || "",
    status: row.status,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    revokedAt: row.revoked_at || null
  };
}

function requireSecret(value) {
  const secret = String(value || "");
  if (secret.length < 32 || secret.length > 256) {
    throw new HttpError(400, "INVALID_PAIRING_SECRET", "配对凭证无效。");
  }
  return hashSecret(secret);
}

function normalizeDeviceName(value) {
  const name = String(value || "").trim();
  if (!name || name.length > 60) {
    throw new HttpError(400, "INVALID_DEVICE_NAME", "设备名称需要在 1 到 60 个字符之间。");
  }
  return name;
}

function normalizePublicKey(value) {
  const publicKey = String(value || "").trim();
  if (publicKey.length > 4096) {
    throw new HttpError(400, "INVALID_DEVICE_PUBLIC_KEY", "设备公钥过长。");
  }
  return publicKey;
}

function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function assertNotExpired(session) {
  if (session.expires_at <= Date.now()) {
    throw new HttpError(410, "PAIRING_SESSION_EXPIRED", "配对会话已经过期。");
  }
}

function pairingStateConflict() {
  return new HttpError(409, "PAIRING_STATE_CONFLICT", "配对会话当前状态不允许这个操作。");
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.trunc(number)));
}

module.exports = { DeviceService };
