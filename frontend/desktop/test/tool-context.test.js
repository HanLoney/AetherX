const assert = require("node:assert/strict");
const test = require("node:test");

const { ToolRegistry, projectToolResult } = require("../tool-registry");
const { registerJournalTools } = require("../journal-tools");

test("model tool results remove embedded media without changing the UI result", async () => {
  const originalDesktop = globalThis.desktop;
  const journals = Array.from({ length: 25 }, (_, index) => ({
    id: `journal-${index}`,
    type: "daily",
    title: `日记 ${index}`,
    mood: "平静",
    periodKey: `2026-08-${String(index + 1).padStart(2, "0")}`,
    sourceFrom: index,
    sourceTo: index + 1,
    content: `正文 ${index}\n![配图](data:image/png;base64,${"A".repeat(100_000)})`
  }));
  globalThis.desktop = { listJournals: async () => journals };
  try {
    const registry = new ToolRegistry();
    registerJournalTools(registry);
    const full = await registry.call("journal.list", { limit: 30 });
    const projected = registry.modelResult("journal.list", full);
    const serialized = JSON.stringify(projected);

    assert.match(full.data[0].content, /data:image\/png;base64/);
    assert.doesNotMatch(serialized, /data:image\/png;base64/);
    assert.ok(serialized.length < 32_000);
    assert.equal(projected.data[0].title, "日记 0");
    assert.ok(projected.data[0].excerpt.length < 1_000);
  } finally {
    globalThis.desktop = originalDesktop;
  }
});

test("generic model projection bounds unknown rich tool payloads", () => {
  const projected = projectToolResult({
    ok: true,
    content: "读取完成",
    data: Array.from({ length: 40 }, (_, index) => ({
      id: index,
      source: `data:image/webp;base64,${"B".repeat(80_000)}`,
      content: "C".repeat(20_000)
    }))
  });
  const serialized = JSON.stringify(projected);
  assert.doesNotMatch(serialized, /data:image\/webp;base64/);
  assert.ok(serialized.length <= 32_000);
});
