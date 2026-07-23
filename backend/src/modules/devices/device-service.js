const { createHash, randomBytes } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");

const DEFAULT_PAIRING_TTL_SECONDS = 120;
const MIN_PAIRING_TTL_SECONDS = 60;
const MAX_PAIRING_TTL_SECONDS = 600;
const MOBILE_HEALTH_PROTOCOL_VERSION = 1;

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

  recordHeartbeat(userId, auth, input = {}) {
    const now = Date.now();
    const row = this.repository.upsertMobileHealth({
      id: normalizeClientId(input.installationId),
      userId,
      pairedDeviceId: auth?.kind === "device" ? auth.deviceId : null,
      name: normalizeDeviceName(input.name || "AetherX 移动端"),
      platform: boundedText(input.platform, 20, "unknown"),
      model: boundedText(input.model, 80),
      osVersion: boundedText(input.osVersion, 40),
      appVersion: boundedText(input.appVersion, 40),
      protocolVersion: positiveInteger(input.protocolVersion, 0),
      syncStatus: normalizeSyncStatus(input.syncStatus),
      syncCursor: nonNegativeInteger(input.syncCursor),
      sseConnected: Boolean(input.sseConnected),
      foreground: input.foreground !== false,
      latencyMs: nullableLatency(input.latencyMs),
      lastError: boundedText(input.lastError, 240),
      now
    });
    return { serverTime: now, client: presentMobileHealth(row, now) };
  }

  listMobileHealth(userId) {
    const now = Date.now();
    return this.repository.listMobileHealth(userId).map((row) => presentMobileHealth(row, now));
  }

  listAllMobileHealth() {
    const now = Date.now();
    return this.repository.listAllMobileHealth().map((row) => presentMobileHealth(row, now));
  }

  getMobileHealthSummary() {
    const clients = this.listAllMobileHealth();
    const summary = {
      tracked: clients.length,
      healthy: 0,
      warning: 0,
      idle: 0,
      offline: 0,
      incompatible: 0,
      lastHeartbeatAt: null
    };
    for (const client of clients) {
      const status = Object.prototype.hasOwnProperty.call(summary, client.status)
        ? client.status
        : "offline";
      summary[status] += 1;
      if (
        summary.lastHeartbeatAt === null ||
        client.lastHeartbeatAt > summary.lastHeartbeatAt
      ) {
        summary.lastHeartbeatAt = client.lastHeartbeatAt;
      }
    }
    return summary;
  }

  setSseConnection(userId, installationId, connected, cursor = 0) {
    const id = normalizeOptionalClientId(installationId);
    if (!id) return false;
    return this.repository.updateMobileConnection(
      userId,
      id,
      connected,
      nonNegativeInteger(cursor),
      Date.now()
    );
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

function presentMobileHealth(row, now = Date.now()) {
  const lastHeartbeatAt = row.last_heartbeat_at;
  const ageMs = Math.max(0, now - lastHeartbeatAt);
  const compatible = row.protocol_version === MOBILE_HEALTH_PROTOCOL_VERSION;
  let status = "offline";
  if (!compatible && ageMs <= 5 * 60_000) {
    status = "incompatible";
  } else if (!row.foreground && ageMs <= 5 * 60_000) {
    status = "idle";
  } else if (ageMs <= 50_000) {
    status = row.sync_status === "error" || !row.sse_connected ? "warning" : "healthy";
  } else if (ageMs <= 5 * 60_000) {
    status = "idle";
  }
  return {
    id: row.id,
    pairedDeviceId: row.paired_device_id || null,
    name: row.name,
    platform: row.platform,
    model: row.model,
    osVersion: row.os_version,
    appVersion: row.app_version,
    protocolVersion: row.protocol_version,
    compatible,
    syncStatus: row.sync_status,
    syncCursor: row.sync_cursor,
    sseConnected: Boolean(row.sse_connected),
    foreground: Boolean(row.foreground),
    latencyMs: row.latency_ms,
    lastError: row.last_error,
    lastHeartbeatAt,
    ageMs,
    status
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

function normalizeClientId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9._:-]{8,100}$/.test(id)) {
    throw new HttpError(400, "INVALID_MOBILE_CLIENT_ID", "移动端安装标识无效。");
  }
  return id;
}

function normalizeOptionalClientId(value) {
  const id = String(value || "").trim();
  return /^[A-Za-z0-9._:-]{8,100}$/.test(id) ? id : "";
}

function normalizeSyncStatus(value) {
  const status = String(value || "idle").trim().toLocaleLowerCase();
  return ["idle", "syncing", "online", "error"].includes(status) ? status : "error";
}

function boundedText(value, maximum, fallback = "") {
  const text = String(value || "").trim();
  return (text || fallback).slice(0, maximum);
}

function nonNegativeInteger(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function nullableLatency(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number >= 0 && number <= 300_000 ? number : null;
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

module.exports = { DeviceService, MOBILE_HEALTH_PROTOCOL_VERSION, presentMobileHealth };
