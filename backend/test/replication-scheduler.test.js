const assert = require("node:assert/strict");
const test = require("node:test");
const {
  ReplicationScheduler
} = require("../src/modules/replication/replication-scheduler");

test("concurrent ordinary replication requests share one run", async () => {
  const gate = deferred();
  const started = deferred();
  const harness = createHarness({
    pullUntilCurrent: async () => {
      harness.calls.pull += 1;
      started.resolve();
      await gate.promise;
      return { localSequence: 3, remoteSequence: 3 };
    }
  });

  const first = harness.scheduler.runNow("user-1");
  await started.promise;
  const second = harness.scheduler.runNow("user-1");
  gate.resolve();

  const [firstResult, secondResult] = await Promise.all([first, second]);
  assert.equal(harness.calls.pull, 1);
  assert.equal(harness.calls.media, 1);
  assert.deepEqual(secondResult, firstResult);
});

test("a transition sync waits for the current run and then forces a fresh run", async () => {
  const gate = deferred();
  const started = deferred();
  const harness = createHarness({
    pullUntilCurrent: async () => {
      harness.calls.pull += 1;
      if (harness.calls.pull === 1) {
        started.resolve();
        await gate.promise;
      }
      return { localSequence: 5, remoteSequence: 5 };
    }
  });

  const ordinary = harness.scheduler.runNow("user-1");
  await started.promise;
  const transition = harness.scheduler.runNow("user-1", { allowTransition: true });
  gate.resolve();
  await Promise.all([ordinary, transition]);

  assert.equal(harness.calls.pull, 2);
  assert.equal(harness.calls.media, 2);
});

test("healthy idle replication skips media scans until data changes or rescan is due", async () => {
  const harness = createHarness({
    initialHealth: {
      state: "healthy",
      localSequence: 7,
      remoteSequence: 7,
      lastSuccessAt: 900,
      consecutiveFailures: 0
    },
    mediaRescanIntervalMs: 5_000,
    now: 1_000
  });

  await harness.scheduler.runNow("user-1");
  const idle = await harness.scheduler.runNow("user-1");
  assert.equal(harness.calls.media, 1);
  assert.equal(idle.media.scanSkipped, true);
  assert.equal(idle.media.pendingCount, 0);

  harness.progress.localSequence = 8;
  harness.progress.remoteSequence = 8;
  await harness.scheduler.runNow("user-1");
  assert.equal(harness.calls.media, 2);

  harness.clock.value += 5_000;
  await harness.scheduler.runNow("user-1");
  assert.equal(harness.calls.media, 3);
});

function createHarness(options = {}) {
  const calls = { hello: 0, pull: 0, media: 0 };
  const clock = { value: options.now ?? 1_000 };
  const progress = { localSequence: 7, remoteSequence: 7 };
  let health = options.initialHealth || null;
  const repository = {
    find: () => health,
    save: (next) => {
      health = { ...next };
      return health;
    }
  };
  const clusterService = {
    ensureSpace: () => ({
      space_id: "space-1",
      local_node_id: "standby-1",
      active_node_id: "active-1",
      state: "stable",
      protocol_version: 1,
      schema_version: 1,
      epoch: 1
    })
  };
  const clusterRepository = {
    listSpaceUserIds: () => ["user-1"],
    findNode: (_spaceId, nodeId) => ({
      id: nodeId,
      status: nodeId === "standby-1" ? "standby" : "active"
    })
  };
  const peerTransport = {
    requestJson: async () => {
      calls.hello += 1;
      return { data: {} };
    }
  };
  const bootstrapCoordinator = {
    pullUntilCurrent: options.pullUntilCurrent || (async () => {
      calls.pull += 1;
      return { ...progress };
    })
  };
  const mediaReplicationService = {
    status: () => ({ pendingCount: 0, pendingBytes: 0, receivedBytes: 0 }),
    synchronizeFromPeer: async () => {
      calls.media += 1;
      return {
        discovered: 0,
        transferred: 0,
        skipped: 0,
        pages: 1,
        pendingCount: 0,
        pendingBytes: 0,
        receivedBytes: 0
      };
    }
  };
  const scheduler = new ReplicationScheduler({
    repository,
    clusterService,
    clusterRepository,
    peerTransport,
    bootstrapCoordinator,
    mediaReplicationService,
    pollIntervalMs: 500,
    mediaRescanIntervalMs: options.mediaRescanIntervalMs || 5_000,
    now: () => clock.value,
    random: () => 0.5
  });
  return { scheduler, calls, clock, progress };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
