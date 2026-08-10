const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  isLoopbackHubUrl,
  prepareHubDataDir,
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

  const packagedRoot = path.join(filesystemRoot, "Users", "test");
  const packagedApp = {
    isPackaged: true,
    getPath: (kind) => kind === "appData"
      ? packagedRoot
      : path.join(packagedRoot, "aetherx-desktop")
  };
  assert.equal(
    resolveHubDataDir(packagedApp, "ignored", {}),
    path.join(packagedRoot, "AetherX", "hub")
  );
});

test("packaged desktop migrates its legacy Hub into the shared AetherX data directory", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-desktop-hub-"));
  const userData = path.join(root, "aetherx-desktop");
  const legacyDir = path.join(userData, "hub");
  fs.mkdirSync(legacyDir, { recursive: true });
  fs.writeFileSync(path.join(legacyDir, "xuanai.db"), "database");
  const app = {
    isPackaged: true,
    getPath: (kind) => kind === "appData" ? root : userData
  };
  try {
    const dataDir = await prepareHubDataDir(app, "ignored", {});
    assert.equal(dataDir, path.join(root, "AetherX", "hub"));
    assert.equal(fs.readFileSync(path.join(dataDir, "xuanai.db"), "utf8"), "database");
    assert.equal(fs.existsSync(legacyDir), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
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
    control: fakeControl(),
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
  assert.equal(hub.runtimeMode, "embedded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].host, "0.0.0.0");
  assert.equal(calls[0].port, 4318);
  assert.equal(calls[0].replicationSchedulerEnabled, true);
  assert.equal(calls[0].switchRecoveryEnabled, true);
  assert.equal(calls[0].replicationPollIntervalMs, 5000);
  assert.equal(calls[0].replicationMaxBackoffMs, 300000);
  assert.equal(reverseCalls.length, 1);
  assert.equal(reverseCalls[0].env.AETHERX_PORT, "4318");
  await hub.stop();
  assert.equal(closed, true);
});

test("desktop safely stops a managed Hub with the same data directory before takeover", async () => {
  const commands = [];
  let healthy = true;
  let listened = false;
  const dataDir = path.join("D:", "project", "backend", ".data");
  const control = fakeControl(async (_pipe, command) => {
    commands.push(command);
    if (command === "status") {
      return { ok: true, component: "hub", healthy: true, pid: 42, dataDir, host: "launcher" };
    }
    healthy = false;
    return { ok: true, stopping: true };
  });
  const hub = await startLocalHub({
    electronApp: { isPackaged: false, getPath: () => "unused" },
    baseUrl: "http://127.0.0.1:4318",
    desktopDir: path.join("D:", "project", "frontend", "desktop"),
    environment: {},
    control,
    fetchImpl: async () => {
      if (!healthy) throw new Error("offline");
      return { ok: true, json: async () => ({ data: { service: "aetherx-backend" } }) };
    },
    createBackendApp() {
      return { listen: async () => { listened = true; }, close: async () => {} };
    }
  });

  assert.deepEqual(commands, ["status", "stop"]);
  assert.equal(listened, true);
  assert.equal(hub.owned, true);
  assert.equal(hub.takeover.status, "completed");
  assert.equal(hub.takeover.previousHost, "launcher");
  await hub.stop();
});

test("desktop upgrades and takes over a legacy launcher Hub without ownership metadata", async () => {
  const commands = [];
  let healthy = true;
  const control = fakeControl(async (_pipe, command) => {
    commands.push(command);
    if (command === "status") {
      return { ok: true, component: "hub", healthy: true, pid: 41, port: 4318 };
    }
    healthy = false;
    return { ok: true, stopping: true };
  });
  const hub = await startLocalHub({
    electronApp: { isPackaged: false, getPath: () => "unused" },
    baseUrl: "http://127.0.0.1:4318",
    desktopDir: path.join("D:", "project", "frontend", "desktop"),
    environment: {},
    control,
    fetchImpl: async () => {
      if (!healthy) throw new Error("offline");
      return { ok: true, json: async () => ({ data: { service: "aetherx-backend" } }) };
    },
    createBackendApp: () => ({ listen: async () => {}, close: async () => {} })
  });

  assert.deepEqual(commands, ["status", "stop"]);
  assert.equal(hub.owned, true);
  assert.equal(hub.takeover.previousHost, "legacy-launcher");
  await hub.stop();
});

test("desktop refuses to take over a managed Hub using another data directory", async () => {
  const control = fakeControl(async () => ({
    ok: true,
    component: "hub",
    healthy: true,
    pid: 77,
    dataDir: path.join("D:", "other-data"),
    host: "external"
  }));
  const hub = await startLocalHub({
    electronApp: { isPackaged: false, getPath: () => "unused" },
    baseUrl: "http://127.0.0.1:4318",
    desktopDir: path.join("D:", "project", "frontend", "desktop"),
    environment: {},
    control,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: { service: "aetherx-backend" } })
    })
  });

  assert.equal(hub.owned, false);
  assert.equal(hub.runtimeMode, "external");
  assert.equal(hub.takeover.status, "data-dir-mismatch");
});

function fakeControl(requestHubControl = async () => ({ ok: false })) {
  return {
    getHubControlPipe: () => "test-hub-pipe",
    requestHubControl,
    createHubControlServer: async () => ({ close: (callback) => callback() })
  };
}
