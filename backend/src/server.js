const { loadConfig } = require("./config");
const { createApp } = require("./app");
const {
  createHubControlServer,
  getHubControlPipe
} = require("./infrastructure/hub-control-channel");

const config = loadConfig();
const app = createApp(config);
let controlServer = null;
let stopping = false;

start().catch((error) => {
  console.error("AetherX backend failed to start.", error);
  process.exit(1);
});

async function start() {
  await app.listen();
  controlServer = await createHubControlServer(
    process.env.AETHERX_HUB_CONTROL_PIPE || getHubControlPipe(),
    async (command) => {
      if (command === "status") {
        return {
          component: "hub",
          pid: process.pid,
          healthy: true,
          port: config.port,
          dataDir: config.dataDir,
          host: "standalone"
        };
      }
      if (command === "stop") {
        setImmediate(() => shutdown().catch(() => process.exit(1)));
        return { stopping: true };
      }
      throw new Error("Unsupported Hub control command.");
    }
  );
  console.log(`AetherX backend listening on http://${config.host}:${config.port}`);
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  if (controlServer) await new Promise((resolve) => controlServer.close(resolve));
  controlServer = null;
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
