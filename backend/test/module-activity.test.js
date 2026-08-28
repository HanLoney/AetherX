const assert = require("node:assert/strict");
const test = require("node:test");
const { ModuleActivityService } = require("../src/modules/module-activity/module-activity-service");

test("模块调用遥测记录开始、结束、方向与耗时", () => {
  const service = new ModuleActivityService();
  const started = service.begin("user-1", {
    sourceModuleId: "ai",
    targetModuleId: "memory",
    operation: "读取长期记忆",
    startedAt: 1000,
    createdAt: 1000
  });
  const finished = service.finish("user-1", started.callId, {
    status: "success",
    createdAt: 1128
  });

  assert.equal(started.status, "running");
  assert.equal(finished.sourceModuleId, "ai");
  assert.equal(finished.targetModuleId, "memory");
  assert.equal(finished.durationMs, 128);
  assert.deepEqual(service.list("user-1").events.map((event) => event.status), ["running", "success"]);
});

test("模块调用遥测按用户隔离并支持增量游标", () => {
  const service = new ModuleActivityService();
  const first = service.record("user-1", {
    sourceModuleId: "proactive-reminders",
    targetModuleId: "todo",
    operation: "检查待办",
    status: "success"
  });
  service.record("user-2", {
    sourceModuleId: "dreams",
    targetModuleId: "ai",
    operation: "生成梦境",
    status: "running"
  });
  const second = service.record("user-1", {
    sourceModuleId: "autonomous-journal",
    targetModuleId: "image-generation",
    operation: "生成手记配图",
    status: "error"
  });

  assert.deepEqual(service.list("user-1", { after: first.seq }).events.map((event) => event.seq), [second.seq]);
  assert.equal(service.list("user-2").events.length, 1);
});

test("模块调用遥测拒绝不存在的模块", () => {
  const service = new ModuleActivityService();
  assert.throws(
    () => service.record("user-1", {
      sourceModuleId: "unknown",
      targetModuleId: "ai",
      status: "running"
    }),
    (error) => error.code === "INVALID_MODULE_ACTIVITY"
  );
});
