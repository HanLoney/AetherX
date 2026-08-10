const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { deriveSyncState, normalizedProgress } = require("../connection-center");

test("connection center reports a caught-up mobile Hub as synchronized", () => {
  const mobile = {
    ready: true,
    replication: { caughtUp: true },
    progress: { progress: 73 }
  };

  assert.equal(normalizedProgress(mobile), 100);
  assert.deepEqual(deriveSyncState({ state: "stable" }, mobile), {
    state: "healthy",
    title: "已同步",
    detail: "SIGNED OPERATION / BLOB",
    progress: 100
  });
});

test("connection center preserves partial mobile Hub synchronization progress", () => {
  const mobile = {
    ready: false,
    replication: { caughtUp: false },
    progress: { progress: 41.6 }
  };

  assert.equal(normalizedProgress(mobile), 42);
  assert.deepEqual(deriveSyncState({ state: "stable" }, mobile), {
    state: "syncing",
    title: "同步中 42%",
    detail: "正在追平手机 Hub",
    progress: 42
  });
});

test("connection center clearly reports an unpaired mobile Hub", () => {
  assert.equal(normalizedProgress(null), 0);
  assert.deepEqual(deriveSyncState({ state: "stable" }, null), {
    state: "offline",
    title: "未配置双 Hub",
    detail: "等待手机 Hub 配对",
    progress: 0
  });
});

test("desktop package ships the connection center and Tailscale status runtime", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
  assert.ok(packageJson.build.files.includes("connection-center.js"));
  assert.ok(packageJson.build.extraResources.some((resource) =>
    resource.from === "../launcher/tailscale-manager.js" &&
    resource.to === "connection-runtime/tailscale-manager.js"
  ));
});
