const path = require("node:path");

function loadConfig(environment = process.env) {
  return {
    host: environment.AETHERX_HOST || environment.XUANAI_HOST || "127.0.0.1",
    port: Number(environment.AETHERX_PORT || environment.XUANAI_PORT || 4318),
    dataDir:
      environment.AETHERX_DATA_DIR ||
      environment.XUANAI_DATA_DIR ||
      path.join(process.cwd(), ".data"),
    masterKey:
      environment.AETHERX_MASTER_KEY || environment.XUANAI_MASTER_KEY || "",
    registrationMode: normalizeRegistrationMode(
      environment.AETHERX_REGISTRATION_MODE || "open"
    ),
    registrationSecret: environment.AETHERX_REGISTRATION_SECRET || "",
    sessionTtlDays: Number(environment.AETHERX_SESSION_TTL_DAYS || 30),
    replicationSchedulerEnabled: normalizeBoolean(
      environment.AETHERX_REPLICATION_SCHEDULER_ENABLED,
      true,
      "AETHERX_REPLICATION_SCHEDULER_ENABLED"
    ),
    switchRecoveryEnabled: normalizeBoolean(
      environment.AETHERX_SWITCH_RECOVERY_ENABLED,
      true,
      "AETHERX_SWITCH_RECOVERY_ENABLED"
    ),
    replicationPollIntervalMs: positiveInteger(
      environment.AETHERX_REPLICATION_POLL_INTERVAL_MS,
      5000
    ),
    replicationMaxBackoffMs: positiveInteger(
      environment.AETHERX_REPLICATION_MAX_BACKOFF_MS,
      300000
    ),
    corsOrigin:
      environment.AETHERX_CORS_ORIGIN || environment.XUANAI_CORS_ORIGIN || "*"
  };
}

function normalizeBoolean(value, fallback, field) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error(`${field} must be true or false.`);
}

function positiveInteger(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 250) {
    throw new Error("Replication timing values must be integers of at least 250 ms.");
  }
  return result;
}

function normalizeRegistrationMode(value) {
  const mode = String(value || "open").trim().toLocaleLowerCase();
  if (!["open", "invite", "closed"].includes(mode)) {
    throw new Error("AETHERX_REGISTRATION_MODE must be open, invite or closed.");
  }
  return mode;
}

module.exports = { loadConfig, normalizeRegistrationMode };
