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

function registerDiscoveryRoute(overrides = {}) {
  const routes = [];
  const calls = [];
  const hub = { id: "android-1", active: true };
  const router = {
    add(method, path, handler, options) {
      routes.push({ method, path, handler, options });
    }
  };
  const service = {
    status: () => ({}),
    mobileHubs: () => [],
    requireMobileHub(userId, nodeId) {
      calls.push(["require", userId, nodeId]);
      return hub;
    }
  };
  const peerTransport = {
    async discoverEndpoint(userId, nodeId, endpoint) {
      calls.push(["discover", userId, nodeId, endpoint]);
      return { ...endpoint, id: "endpoint-1" };
    },
    ...overrides.peerTransport
  };
  registerClusterRoutes(
    router,
    service,
    null,
    null,
    null,
    null,
    null,
    null,
    peerTransport
  );
  return {
    calls,
    route: routes.find((route) =>
      route.method === "POST" &&
      route.path === "/api/v1/cluster/mobile-hubs/:id/discover-endpoint"
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

test("mobile Hub discovery authenticates a normalized private LAN endpoint", async () => {
  const { calls, route } = registerDiscoveryRoute();

  const response = await route.handler({
    userId: "user-1",
    params: { id: "android-1" },
    body: {
      endpoint: {
        transport: "lan",
        address: "http://192.168.1.23:4319/untrusted/path?ignored=1",
        priority: 5000,
        certificateFingerprint: "untrusted"
      }
    }
  });

  assert.equal(response.data.discovered, true);
  assert.deepEqual(calls, [
    ["require", "user-1", "android-1"],
    [
      "discover",
      "user-1",
      "android-1",
      {
        transport: "lan",
        address: "http://192.168.1.23:4319",
        priority: 1000,
        certificateFingerprint: ""
      }
    ]
  ]);
});

test("mobile Hub discovery rejects public, Anywhere and unexpected-port endpoints", async () => {
  const invalidEndpoints = [
    { transport: "lan", address: "http://203.0.113.5:4319" },
    { transport: "anywhere", address: "https://mobile.example.test" },
    { transport: "lan", address: "http://192.168.1.23:8080" }
  ];

  for (const endpoint of invalidEndpoints) {
    const { route } = registerDiscoveryRoute();
    await assert.rejects(
      () => route.handler({
        userId: "user-1",
        params: { id: "android-1" },
        body: { endpoint }
      }),
      (error) => error.code === "PEER_ENDPOINT_INVALID"
    );
  }
});
