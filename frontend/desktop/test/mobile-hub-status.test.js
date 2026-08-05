const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  loadMobileHubStatus,
  mergeMobileHubStatus
} = require("../mobile-hub-status");

test("desktop package includes the mobile Hub status synthesizer", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../package.json"), "utf8"));
  assert.ok(packageJson.build.files.includes("mobile-hub-status.js"));
});

test("cluster status restores an active mobile Hub when detailed status is unavailable", () => {
  const hubs = mergeMobileHubStatus({
    activeNodeId: "android-1",
    replication: { ready: true },
    nodes: [
      { id: "desktop-1", platform: "windows", status: "standby" },
      { id: "android-1", name: "Android Local Hub", platform: "android", status: "active" }
    ]
  }, []);

  assert.deepEqual(hubs, [{
    id: "android-1",
    name: "Android Local Hub",
    platform: "android",
    status: "active",
    role: "active",
    active: true,
    ready: false
  }]);
});

test("cluster authority overrides stale role fields while preserving Hub detail", () => {
  const hubs = mergeMobileHubStatus({
    activeNodeId: "android-2",
    replication: { ready: true },
    nodes: [{ id: "android-2", platform: "android", status: "active" }]
  }, [{
    id: "android-2",
    active: false,
    ready: true,
    snapshot: { recordCount: 6726 }
  }]);

  assert.equal(hubs[0].active, true);
  assert.equal(hubs[0].ready, false);
  assert.equal(hubs[0].role, "active");
  assert.deepEqual(hubs[0].snapshot, { recordCount: 6726 });
});

test("mobile Hub detection matches the desktop header when platform metadata is missing", () => {
  const hubs = mergeMobileHubStatus({
    activeNodeId: "android-legacy",
    nodes: [{ id: "android-legacy", name: "Android Local Hub", status: "active" }]
  }, []);

  assert.equal(hubs.length, 1);
  assert.equal(hubs[0].active, true);
});

test("detailed status remains usable when cluster status is temporarily unavailable", () => {
  const hubs = mergeMobileHubStatus(null, [{
    id: "android-detail",
    platform: "android",
    status: "active",
    active: true
  }]);

  assert.equal(hubs[0].active, true);
  assert.equal(hubs[0].role, "active");
});

test("mobile Hub status falls back to cached cluster when live requests fail", async () => {
  const cachedCluster = {
    activeNodeId: "android-3",
    nodes: [{ id: "android-3", platform: "android", status: "active" }]
  };
  const result = await loadMobileHubStatus({
    api: {
      getClusterStatus: async () => { throw new Error("offline"); },
      listMobileHubs: async () => { throw new Error("offline"); }
    },
    cachedCluster,
    timeoutMs: 10
  });

  assert.equal(result.cluster, cachedCluster);
  assert.equal(result.hubs[0].active, true);
});
