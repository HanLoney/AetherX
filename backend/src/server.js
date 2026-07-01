const { loadConfig } = require("./config");
const { createApp } = require("./app");

const config = loadConfig();
const app = createApp(config);

app.listen().then(() => {
  console.log(`AetherX backend listening on http://${config.host}:${config.port}`);
});

async function shutdown() {
  await app.close();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
