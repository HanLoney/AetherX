const fs = require("node:fs");
const path = require("node:path");
const { createControlServer } = require("./control-channel");

async function runHubHost(options) {
  const {
    app,
    backendRoot,
    dataDir,
    logDir,
    pipeName,
    host = "127.0.0.1",
    port = 4318
  } = options;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(logDir, { recursive: true });
  const { createApp } = require(path.join(backendRoot, "src", "app.js"));
  const hub = createApp({
    host,
    port,
    dataDir,
    masterKey: process.env.AETHERX_MASTER_KEY || "",
    registrationMode: process.env.AETHERX_REGISTRATION_MODE || "open",
    registrationSecret: process.env.AETHERX_REGISTRATION_SECRET || "",
    sessionTtlDays: Number(process.env.AETHERX_SESSION_TTL_DAYS || 30),
    corsOrigin: process.env.AETHERX_CORS_ORIGIN || "*"
  });
  let stopping = false;
  let controlServer;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (controlServer) await new Promise((resolve) => controlServer.close(resolve));
    await hub.close();
    app.quit();
  };
  await hub.listen();
  controlServer = await createControlServer(pipeName, async (command) => {
    if (command === "status") {
      return { component: "hub", pid: process.pid, healthy: true, port };
    }
    if (command === "stop") {
      setImmediate(() => stop().catch(() => app.exit(1)));
      return { stopping: true };
    }
    throw new Error("不支持的 Hub 控制指令");
  });
  process.on("SIGINT", () => stop().catch(() => app.exit(1)));
  process.on("SIGTERM", () => stop().catch(() => app.exit(1)));
  return { hub, controlServer, stop };
}

module.exports = { runHubHost };
