const assert = require("node:assert/strict");
const test = require("node:test");
const {
  derivePhysiology,
  XuanMoodService
} = require("../src/modules/xuan-mood/xuan-mood-service");

test("拟生心率会按心情变化，同时保持正常范围和渐进变化", () => {
  const happy = derivePhysiology({
    previous: { heartRateBpm: 67, restingHeartRateBpm: 67 },
    state: { currentMood: "很开心", energy: "精力充沛" },
    display: { tone: "happy" },
    event: { intensity: "high" },
    now: 100
  });
  assert.equal(happy.heartRateBpm, 76);
  assert.equal(happy.rhythm, "lively");
  assert.ok(happy.heartRateBpm >= 56 && happy.heartRateBpm <= 102);

  const tired = derivePhysiology({
    previous: happy,
    state: { currentMood: "有些疲惫", energy: "困倦" },
    display: { tone: "tired" },
    event: { intensity: "medium" },
    now: 200
  });
  assert.equal(tired.heartRateBpm, 70);
  assert.ok(tired.heartRateBpm < happy.heartRateBpm);
});

test("手动刷新只让心率缓慢靠近目标值", () => {
  const refreshed = derivePhysiology({
    previous: { heartRateBpm: 92, restingHeartRateBpm: 67 },
    state: { currentMood: "平静", energy: "稳定" },
    display: { tone: "calm" },
    refreshing: true,
    now: 300
  });
  assert.equal(refreshed.heartRateBpm, 89);
  assert.equal(refreshed.rhythm, "alert");
});

test("首次生成心率时直接采用当前状态目标值", () => {
  const initial = derivePhysiology({
    state: { currentMood: "开心", energy: "充沛" },
    display: { tone: "happy" },
    event: { intensity: "medium" },
    now: 400
  });
  assert.equal(initial.heartRateBpm, 84);
  assert.equal(initial.rhythm, "lively");
});

test("没有心情历史时也会建立默认拟生心率", async () => {
  let storedState = null;
  const repository = {
    getLatestDisplay: () => null,
    listRecentEvents: () => [],
    getState: () => storedState,
    saveState: (_userId, state) => {
      storedState = { state, updatedAt: 1 };
      return storedState;
    }
  };
  const service = new XuanMoodService({
    repository,
    configRepository: {},
    providerClient: {}
  });
  const snapshot = await service.getHome("user-1");
  assert.equal(snapshot.state.state.physiology.heartRateBpm, 64);
  assert.equal(snapshot.state.state.physiology.rhythm, "steady");
});
