const assert = require("node:assert/strict");
const test = require("node:test");
const { registerClusterRoutes } = require("../src/modules/hub-cluster/cluster-routes");

function registerSwitchRoute(hub, overrides = {}) {
  const routes = [];
  const router = {
    add(method, path, handler, options) {
      routes.push({ method, path, handler, options });
    }
  };
  const calls = [];
  const service = {
    status: () => ({}),
    mobileHubs: () => [],
    requireMobileHub: () => hub
  };
  const switchStateMachineService = {
    async prepare(userId, body) {
      calls.push(["prepare", userId, body]);
      return { transitionId: "transition-1" };
    },
    async commit(userId, body) {
      calls.push(["commit", userId, body]);
      return { committed: true, activeNodeId: hub.id, epoch: 2 };
    },
    ...overrides.switchStateMachineService
  };
  const peerTransport = {
    async requestJson(userId, peerNodeId, input) {
      calls.push(["peer", userId, peerNodeId, input]);
      return {
        data: {
          completed: true,
          activeNodeId: "desktop-node",
          epoch: 3,
          state: "stable"
        }
      };
    },
    ...overrides.peerTransport
  };
  registerClusterRoutes(
    router,
    service,
    null,
    switchStateMachineService,
    null,
    null,
    null,
    null,
    peerTransport
  );
  return {
    calls,
    route: routes.find((route) =>
      route.method === "POST" && route.path === "/api/v1/cluster/mobile-hubs/:id/switch"
    )
  };
}

test("mobile Hub switch uses the desktop state machine when the phone is standby", async () => {
  const { calls, route } = registerSwitchRoute({
    id: "android-1",
    active: false,
    ready: true
  });

  const response = await route.handler({
    userId: "user-1",
    params: { id: "android-1" },
    body: {}
  });

  assert.equal(response.data.completed, true);
  assert.equal(response.data.target, "mobile");
  assert.deepEqual(calls, [
    [
      "peer",
      "user-1",
      "android-1",
      {
        method: "POST",
        path: "/api/v1/peer/synchronize",
        body: {},
        timeoutMs: 300_000
      }
    ],
    ["prepare", "user-1", { targetNodeId: "android-1" }],
    ["commit", "user-1", { transitionId: "transition-1" }]
  ]);
});

test("mobile Hub switch requests a native handback when the phone is active", async () => {
  const { calls, route } = registerSwitchRoute({
    id: "android-1",
    active: true,
    ready: false
  });

  const response = await route.handler({
    userId: "user-1",
    params: { id: "android-1" },
    body: {}
  });

  assert.equal(response.data.completed, true);
  assert.equal(response.data.target, "desktop");
  assert.deepEqual(calls, [[
    "peer",
    "user-1",
    "android-1",
    {
      method: "POST",
      path: "/api/v1/peer/mobile-switch/request",
      body: {},
      timeoutMs: 300_000
    }
  ]]);
});

test("mobile Hub switch still rejects an incomplete standby replica", async () => {
  const { route } = registerSwitchRoute({
    id: "android-1",
    active: false,
    ready: false
  });

  await assert.rejects(
    () => route.handler({ userId: "user-1", params: { id: "android-1" }, body: {} }),
    (error) => error.code === "MOBILE_HUB_NOT_READY"
  );
});
