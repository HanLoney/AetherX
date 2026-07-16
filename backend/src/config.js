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
    corsOrigin:
      environment.AETHERX_CORS_ORIGIN || environment.XUANAI_CORS_ORIGIN || "*"
  };
}

function normalizeRegistrationMode(value) {
  const mode = String(value || "open").trim().toLocaleLowerCase();
  if (!["open", "invite", "closed"].includes(mode)) {
    throw new Error("AETHERX_REGISTRATION_MODE must be open, invite or closed.");
  }
  return mode;
}

module.exports = { loadConfig, normalizeRegistrationMode };
