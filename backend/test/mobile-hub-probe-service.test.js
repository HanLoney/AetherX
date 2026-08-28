const assert = require("node:assert/strict");
const test = require("node:test");
const { HttpError } = require("../src/lib/http-error");
const {
  DEFAULT_PROBE_TIMEOUT_MS,
  MobileHubProbeService,
  validatePeerStatus
} = require("../src/modules/hub-cluster/mobile-hub-probe-service");

test("mobile Hub probes allow enough time for a relayed Anywhere request", () => {
  assert.equal(DEFAULT_PROBE_TIMEOUT_MS, 5000);
});

function fixture({ hubs, requestJson, now = 200_000 }) {
  const calls = [];
  const service = new MobileHubProbeService({
    clusterService: {
      status: () => ({ spaceId: "space-1", localNodeId: "desktop" }),
      mobileHubs: () => hubs
    },
    peerTransport: {
      async requestJson(userId, nodeId, input) {
        calls.push({ userId, nodeId, input });
        return requestJson(userId, nodeId, input);
      }
    },
    now: () => now,
    timeoutMs: 321
  });
  return { calls, service };
}

test("reachable authenticated mobile Hub is online independently of client heartbeat", async () => {
  const value = fixture({
    hubs: [{
      id: "android-1",
      hubOnline: false,
      client: { status: "offline" },
      replication: { caughtUp: true, localSequence: 12, remoteSequence: 12, lastSuccessAt: 100_000 }
    }],
    requestJson: async (_userId, _nodeId, input) => {
      if (input.path === "/api/v1/peer/status") {
        const data = { spaceId: "space-1", localNodeId: "android-1", epoch: 7 };
        input.validateResponse(data);
        return { data, endpoint: { transport: "lan", address: "http://192.168.1.8:4319" } };
      }
      return { data: { headSequence: 12 }, endpoint: {} };
    }
  });

  const hubs = await value.service.list("user-1");

  assert.equal(hubs[0].hubOnline, true);
  assert.equal(hubs[0].client.status, "offline");
  assert.equal(hubs[0].reachability.transport, "lan");
  assert.equal(hubs[0].replication.confirmedCurrent, true);
  assert.equal(value.calls[0].input.path, "/api/v1/peer/status");
  assert.equal(value.calls[0].input.timeoutMs, 321);
  assert.match(value.calls[1].input.path, /origin=android-1&after=12&limit=1/);
});

test("unreachable mobile Hub overrides a recent historical last-seen value", async () => {
  const value = fixture({
    hubs: [{
      id: "android-1",
      hubOnline: true,
      hubLastSeenAt: 199_999,
      replication: { caughtUp: true, localSequence: 12, remoteSequence: 12, lastSuccessAt: 199_999 }
    }],
    requestJson: async () => {
      throw new HttpError(503, "PEER_UNREACHABLE", "offline", {
        attempts: [{ transport: "lan" }]
      });
    }
  });

  const hubs = await value.service.list("user-1");

  assert.equal(hubs[0].hubOnline, false);
  assert.equal(hubs[0].reachability.code, "PEER_UNREACHABLE");
  assert.equal(hubs[0].replication.confirmedCurrent, false);
});

test("a reachable Hub with a different live operation count is not current", async () => {
  const value = fixture({
    hubs: [{
      id: "android-1",
      replication: { caughtUp: true, localSequence: 12, remoteSequence: 12, lastSuccessAt: 199_999 }
    }],
    requestJson: async (_userId, _nodeId, input) => {
      if (input.path === "/api/v1/peer/status") {
        const data = { spaceId: "space-1", nodeId: "android-1" };
        input.validateResponse(data);
        return { data, endpoint: {} };
      }
      return { data: { headSequence: 13 }, endpoint: {} };
    }
  });

  const hubs = await value.service.list("user-1");

  assert.equal(hubs[0].hubOnline, true);
  assert.equal(hubs[0].replication.caughtUp, true);
  assert.equal(hubs[0].replication.confirmedCurrent, false);
  assert.equal(hubs[0].reachability.remoteOperationCount, 13);
});

test("a reachable Hub remains online when its live sequence cannot be confirmed", async () => {
  const value = fixture({
    hubs: [{
      id: "android-1",
      replication: { caughtUp: true, localSequence: 12, remoteSequence: 12, lastSuccessAt: 199_999 }
    }],
    requestJson: async (_userId, _nodeId, input) => {
      if (input.path === "/api/v1/peer/status") {
        const data = { spaceId: "space-1", nodeId: "android-1" };
        input.validateResponse(data);
        return { data, endpoint: {} };
      }
      throw new HttpError(503, "SEQUENCE_UNAVAILABLE", "sequence unavailable");
    }
  });

  const hubs = await value.service.list("user-1");

  assert.equal(hubs[0].hubOnline, true);
  assert.equal(hubs[0].replication.confirmedCurrent, false);
  assert.equal(hubs[0].reachability.remoteOperationCount, null);
  assert.equal(hubs[0].reachability.sequenceCode, "SEQUENCE_UNAVAILABLE");
});

test("revoked mobile nodes omitted by the cluster service are never probed", async () => {
  const value = fixture({
    hubs: [],
    requestJson: async () => { throw new Error("must not run"); }
  });

  assert.deepEqual(await value.service.list("user-1"), []);
  assert.equal(value.calls.length, 0);
});

test("peer status must match the registered space and node", () => {
  assert.throws(
    () => validatePeerStatus(
      { spaceId: "space-1", localNodeId: "android-other" },
      "space-1",
      "android-1"
    ),
    (error) => error.code === "PEER_IDENTITY_MISMATCH"
  );
});
