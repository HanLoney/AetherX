const test = require("node:test");
const assert = require("node:assert/strict");
const { DesktopSyncCoordinator } = require("./sync-runtime");

test("启动时追到最新游标，但不重复广播历史变更", async () => {
  const pages = [
    { changes: [{ seq: 1 }], nextCursor: 1, hasMore: true },
    { changes: [{ seq: 2 }], nextCursor: 2, hasMore: false }
  ];
  const received = [];
  const coordinator = new DesktopSyncCoordinator({
    api: { listSyncChanges: async () => pages.shift() },
    onChanges: (changes) => received.push(...changes),
    pollIntervalMs: 60_000
  });
  await coordinator.start("server:user");
  assert.equal(coordinator.cursor, 2);
  coordinator.stop();
  assert.deepEqual(received, []);
});

test("运行后合并分页变更并广播一次", async () => {
  const pages = [
    { changes: [], nextCursor: 3, hasMore: false },
    { changes: [{ seq: 4 }], nextCursor: 4, hasMore: true },
    { changes: [{ seq: 5 }], nextCursor: 5, hasMore: false }
  ];
  const received = [];
  const coordinator = new DesktopSyncCoordinator({
    api: { listSyncChanges: async () => pages.shift() },
    onChanges: (changes) => received.push(changes),
    pollIntervalMs: 60_000
  });
  await coordinator.start("server:user");
  await coordinator.pollNow();
  coordinator.stop();
  assert.deepEqual(received, [[{ seq: 4 }, { seq: 5 }]]);
});
