const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MobileHubSyncNotifier
} = require("../src/modules/replication/mobile-hub-sync-notifier");

test("operation bursts produce one targeted mobile Hub sync command", () => {
  const timers = [];
  const published = [];
  const notifier = new MobileHubSyncNotifier({
    clusterService: {
      mobileHubs: () => [
        {
          id: "mobile-1",
          active: false,
          ready: true,
          status: "standby",
          client: { id: "install-1" }
        },
        {
          id: "mobile-active",
          active: true,
          ready: false,
          status: "active",
          client: { id: "install-active" }
        },
        {
          id: "mobile-pairing",
          active: false,
          ready: false,
          status: "pairing",
          client: { id: "install-pairing" }
        }
      ]
    },
    syncEventBroker: {
      publish: (...args) => published.push(args)
    },
    now: () => 2_000,
    createId: () => "command-1",
    setTimeout: (callback, delay) => {
      timers.push({ callback, delay });
      return { unref() {} };
    },
    clearTimeout: () => undefined
  });

  notifier.notify("user-1", {
    operationCount: 2,
    headSequence: 10,
    epoch: 3,
    committedAt: 1_900
  });
  notifier.notify("user-1", {
    operationCount: 4,
    headSequence: 14,
    epoch: 3,
    committedAt: 1_950
  });

  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 350);
  timers[0].callback();
  assert.equal(published.length, 1);
  assert.equal(published[0][0], "user-1");
  assert.equal(published[0][1], "hub-command");
  assert.deepEqual(published[0][2], {
    commandId: "command-1",
    type: "synchronize-local-hub",
    reason: "operations-committed",
    nodeId: "mobile-1",
    operationCount: 6,
    headSequence: 14,
    epoch: 3,
    committedAt: 1_950,
    requestedAt: 2_000
  });
  assert.deepEqual(published[0][3], {
    queueWhenOffline: true,
    alwaysQueue: true,
    clientId: "install-1",
    coalesceKey: "auto-sync:mobile-1",
    ttlMs: 24 * 60 * 60 * 1000
  });
});

test("notifier skips mobile nodes that are not ready or have no client identity", () => {
  let scheduled;
  const published = [];
  const notifier = new MobileHubSyncNotifier({
    clusterService: {
      mobileHubs: () => [
        { id: "mobile-1", active: false, ready: true, status: "standby", client: null },
        { id: "mobile-2", active: false, ready: false, status: "standby", client: { id: "install-2" } }
      ]
    },
    syncEventBroker: { publish: (...args) => published.push(args) },
    setTimeout: (callback) => {
      scheduled = callback;
      return null;
    },
    clearTimeout: () => undefined
  });

  notifier.notify("user-2", { operationCount: 1 });
  scheduled();
  assert.deepEqual(published, []);
});
