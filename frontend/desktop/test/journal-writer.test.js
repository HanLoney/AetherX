const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AetherJournalWriter,
  completedPeriods,
  splitText
} = require("../journal-writer");
const { currentPeriod } = require("../journal-tools");

test("selects the most recently completed day and week", () => {
  const periods = completedPeriods(new Date(2026, 6, 6, 12).getTime());
  assert.equal(periods[0].type, "daily");
  assert.equal(periods[0].periodKey, "2026-07-05");
  assert.equal(periods[0].to - periods[0].from, 24 * 60 * 60_000);
  assert.equal(periods[1].type, "weekly");
  assert.equal(periods[1].to - periods[1].from, 7 * 24 * 60 * 60_000);
});

test("autonomous journal tools target the current local day or week", () => {
  const now = new Date(2026, 6, 8, 15, 30).getTime();
  const daily = currentPeriod("daily", now);
  const weekly = currentPeriod("weekly", now);
  assert.equal(daily.periodKey, "2026-07-08");
  assert.equal(new Date(daily.from).getDay(), 3);
  assert.match(weekly.periodKey, /^2026-W\d{2}$/);
  assert.equal(new Date(weekly.from).getDay(), 1);
  assert.equal(daily.to, now);
  assert.equal(weekly.to, now);
});

test("splits long original history without dropping characters", () => {
  const source = `${"甲".repeat(20)}\n${"乙".repeat(20)}`;
  const chunks = splitText(source, 24);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(""), source);
});

test("reads every original-history chunk before writing and saving", async () => {
  const calls = [];
  let saved;
  const messages = Array.from({ length: 8 }, (_, index) => ({
    conversationTitle: "日常聊天",
    role: index % 2 ? "assistant" : "user",
    content: `第${index + 1}条原始消息-${"内容".repeat(20)}`,
    createdAt: Date.parse("2026-07-01T10:00:00+08:00") + index
  }));
  const writer = new AetherJournalWriter({
    getJournal: async () => null,
    getMaterial: async () => ({
      messages,
      todos: [],
      personalityEvents: [],
      sharedMemories: []
    }),
    saveJournal: async (journal) => {
      saved = journal;
      return { id: "journal-1", ...journal };
    },
    requestAI: async (payload) => {
      calls.push(payload);
      return calls.length < 3
        ? { content: `第${calls.length}段素材笔记` }
        : {
            content:
              '{"title":"今天留下的话","mood":"温暖","content":"我记住了今天的交流。"}'
          };
    },
    extractText: (result) => result.content,
    getSystemPrompt: () => "你是小玄。",
    getRuntime: () => ({}),
    isEnabled: () => true,
    chunkSize: 230
  });

  await writer.write({
    type: "daily",
    periodKey: "2026-07-01",
    from: Date.parse("2026-07-01T00:00:00+08:00"),
    to: Date.parse("2026-07-02T00:00:00+08:00")
  });

  assert.ok(calls.length >= 3);
  assert.equal(saved.sourceMessageCount, messages.length);
  assert.equal(saved.title, "今天留下的话");
  assert.equal(saved.content, "我记住了今天的交流。");
  const originalInputs = calls.slice(0, -1).map((call) => call.messages[1].content).join("");
  messages.forEach((message) => assert.match(originalInputs, new RegExp(message.content)));
});
