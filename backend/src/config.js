const path = require("node:path");

function loadConfig(environment = process.env) {
  return {
    host: environment.XUANAI_HOST || "127.0.0.1",
    port: Number(environment.XUANAI_PORT || 4318),
    dataDir:
      environment.XUANAI_DATA_DIR ||
      path.join(process.cwd(), ".data"),
    masterKey: environment.XUANAI_MASTER_KEY || "",
    corsOrigin: environment.XUANAI_CORS_ORIGIN || "*"
  };
}

module.exports = { loadConfig };
