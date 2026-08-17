const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  deriveSyncState,
  normalizedProgress,
  selectMobileHub
} = require("../connection-center");

test("connection center reports a caught-up mobile Hub as synchronized", () => {
  const mobile = {
    ready: true,
    hubOnline: true,
    replication: { caughtUp: true, confirmedCurrent: true },
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

test("connection center never reports stale caught-up data as synchronized while mobile Hub is offline", () => {
  const mobile = {
    ready: true,
    hubOnline: false,
    client: { status: "offline" },
    replication: { caughtUp: true },
    progress: { progress: 100 }
  };

  assert.deepEqual(deriveSyncState({ state: "stable" }, mobile), {
    state: "waiting",
    title: "等待手机重连",
    detail: "当前无法验证双方数据是否仍然一致",
    progress: 100
  });
});

test("connection center preserves partial mobile Hub synchronization progress", () => {
  const mobile = {
    ready: false,
    hubOnline: true,
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

test("connection center does not call historical replication healthy after a fresh reachability probe", () => {
  const mobile = {
    ready: true,
    hubOnline: true,
    replication: { caughtUp: true, confirmedCurrent: false },
    progress: { progress: 100 }
  };

  assert.notEqual(deriveSyncState({ state: "stable" }, mobile).state, "healthy");
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
  assert.ok(packageJson.build.files.includes("windows-network-profile.js"));
  assert.equal(packageJson.build.nsis.include, "installer.nsh");
  assert.ok(packageJson.build.extraResources.some((resource) =>
    resource.from === "../launcher/tailscale-manager.js" &&
    resource.to === "connection-runtime/tailscale-manager.js"
  ));
});

test("connection center explains why public Wi-Fi blocks direct LAN access", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "../connection-center.js"), "utf8");
  assert.match(source, /lanAccess\.status === "public"/);
  assert.match(source, /当前 Wi-Fi 为公用网络/);
  assert.match(source, /可信家庭网络请设为专用，跨网络请启用 Anywhere/);
});

test("connection center prefers the current online mobile Hub over stale records", () => {
  const selected = selectMobileHub([
    {
      id: "android-old",
      lastSeenAt: 100,
      hubOnline: false,
      hubLastSeenAt: 100,
      client: { status: "offline", lastHeartbeatAt: 100 }
    },
    {
      id: "android-current",
      lastSeenAt: 300,
      hubOnline: true,
      hubLastSeenAt: 300,
      client: { status: "idle", lastHeartbeatAt: 200 }
    }
  ]);

  assert.equal(selected.id, "android-current");
});

test("connection center prefers a live native Hub over an awake stale client", () => {
  const selected = selectMobileHub([
    {
      id: "android-client-awake",
      hubOnline: false,
      hubLastSeenAt: 100,
      client: { status: "healthy", lastHeartbeatAt: 400 }
    },
    {
      id: "android-hub-online",
      hubOnline: true,
      hubLastSeenAt: 300,
      client: { status: "offline", lastHeartbeatAt: 200 }
    }
  ]);

  assert.equal(selected.id, "android-hub-online");
});

test("connection center never selects a revoked mobile Hub", () => {
  const selected = selectMobileHub([
    {
      id: "android-revoked",
      active: true,
      revokedAt: 200,
      client: { status: "healthy", lastHeartbeatAt: 400 }
    },
    {
      id: "android-current",
      revokedAt: null,
      client: { status: "idle", lastHeartbeatAt: 300 }
    }
  ]);

  assert.equal(selected.id, "android-current");
});
