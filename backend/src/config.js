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
    registrationSecret: environment.AETHERX_REGISTRATION_SECRET || "",
    sessionTtlDays: Number(environment.AETHERX_SESSION_TTL_DAYS || 30),
    corsOrigin:
      environment.AETHERX_CORS_ORIGIN || environment.XUANAI_CORS_ORIGIN || "*"
  };
}

module.exports = { loadConfig };
