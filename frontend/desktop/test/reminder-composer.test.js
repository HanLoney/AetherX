const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AetherReminderComposer
} = require("../reminder-composer");

function reminder() {
  return {
    phase: "upcoming",
    text: "整理产品路线图",
    startAt: Date.parse("2026-07-02T10:00:00+08:00"),
    endAt: Date.parse("2026-07-02T11:00:00+08:00"),
    body: "「整理产品路线图」还有 10 分钟开始。"
  };
}

function createComposer(overrides = {}) {
  return new AetherReminderComposer({
    requestAI: async () => ({ content: "洛尼，路线图快开始啦，先收个尾吧。" }),
    extractText: (result) => result.content,
    getSystemPrompt: () => "你是会持续成长的数字伙伴。",
    getRuntime: () => ({ timeAwareness: true, timeZone: "Asia/Shanghai" }),
    getUserName: () => "洛尼",
    canUseAI: () => true,
    ...overrides
  });
}

test("uses the current personality prompt and reminder facts for AI wording", async () => {
  let payload;
  const composer = createComposer({
    requestAI: async (input) => {
      payload = input;
      return { content: "洛尼，路线图快开始啦，先收个尾吧。" };
    }
  });

  const content = await composer.compose(reminder());

  assert.equal(content, "洛尼，路线图快开始啦，先收个尾吧。");
  assert.match(payload.messages[0].content, /数字伙伴/);
  assert.match(payload.messages[0].content, /只输出一到两句/);
  assert.match(payload.messages[1].content, /整理产品路线图/);
  assert.equal(payload.runtime.timeZone, "Asia/Shanghai");
});

test("falls back to a reliable template when AI generation fails", async () => {
  const composer = createComposer({
    requestAI: async () => {
      throw new Error("offline");
    }
  });

  const content = await composer.compose(reminder());

  assert.match(content, /洛尼/);
  assert.match(content, /还有 10 分钟开始/);
});

test("does not call AI when no model is configured", async () => {
  let requestCount = 0;
  const composer = createComposer({
    canUseAI: () => false,
    requestAI: async () => {
      requestCount += 1;
      return { content: "unused" };
    }
  });

  await composer.compose(reminder());

  assert.equal(requestCount, 0);
});
