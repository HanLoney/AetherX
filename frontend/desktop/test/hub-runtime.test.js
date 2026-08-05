const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  isLoopbackHubUrl,
  resolveBackendRoot,
  resolveHubDataDir,
  startLocalHub
} = require("../hub-runtime");

test("only loopback server URLs start the bundled desktop hub", () => {
  assert.equal(isLoopbackHubUrl("http://127.0.0.1:4318"), true);
  assert.equal(isLoopbackHubUrl("http://localhost:4318"), true);
  assert.equal(isLoopbackHubUrl("https://api.aetherx.tech"), false);
  assert.equal(isLoopbackHubUrl("not-a-url"), false);
});

test("desktop Hub startup is independent from the currently routed client Hub", () => {
  const mainSource = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const startup = mainSource.match(/localHub = await startLocalHub\([\s\S]*?\n\s*\}\);/)?.[0];
  assert.ok(startup);
  assert.match(mainSource, /const localHubServerUrl = "http:\/\/127\.0\.0\.1:4318";/);
  assert.match(startup, /baseUrl: localHubServerUrl/);
  assert.doesNotMatch(startup, /baseUrl: api\.baseUrl/);
});

test("hub paths preserve development data and isolate packaged data", () => {
  const filesystemRoot = path.parse(process.cwd()).root;
  const desktopDir = path.join(
    filesystemRoot,
    "project",
    "frontend",
    "desktop"
  );
  const developmentApp = {
    isPackaged: false,
    getPath: () => path.join(filesystemRoot, "ignored")
  };
  const backendRoot = resolveBackendRoot(developmentApp, desktopDir);
  assert.equal(backendRoot, path.join(filesystemRoot, "project", "backend"));
  assert.equal(
    resolveHubDataDir(developmentApp, backendRoot, {}),
    path.join(filesystemRoot, "project", "backend", ".data")
  );

  const packagedApp = {
    isPackaged: true,
    getPath: () =>
      path.join(filesystemRoot, "Users", "test", "AetherX")
  };
  assert.equal(
    resolveHubDataDir(packagedApp, "ignored", {}),
    path.join(filesystemRoot, "Users", "test", "AetherX", "hub")
  );
});

test("local hub starts once and returns an owned shutdown handle", async () => {
  const calls = [];
  const reverseCalls = [];
  let closed = false;
  const hub = await startLocalHub({
    electronApp: {
      isPackaged: false,
      getPath: () => "unused"
    },
    baseUrl: "http://127.0.0.1:4318",
    desktopDir: path.join("D:", "project", "frontend", "desktop"),
    environment: {},
    enableAdbReverse: true,
    ensureAdbReverse: (options) => reverseCalls.push(options),
    fetchImpl: async () => {
      throw new Error("offline");
    },
    createBackendApp(config) {
      calls.push(config);
      return {
        listen: async () => {},
        close: async () => {
          closed = true;
        }
      };
    }
  });

  assert.equal(hub.owned, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, "0.0.0.0");
  assert.equal(calls[0].port, 4318);
  assert.equal(reverseCalls.length, 1);
  assert.equal(reverseCalls[0].env.AETHERX_PORT, "4318");
  await hub.stop();
  assert.equal(closed, true);
});
