const test = require("node:test");
const assert = require("node:assert/strict");
const { registerJournalTools } = require("../journal-tools");

function makeRegistry() {
  const tools = new Map();
  return {
    tools,
    register(tool) {
      tools.set(tool.name, tool);
      return this;
    }
  };
}

test("journal.write runs content through illustrate before saving", async () => {
  let saved;
  global.desktop = {
    getJournalMaterial: async () => ({ messages: [] }),
    saveJournal: async (journal) => {
      saved = journal;
      return { id: "j1", ...journal };
    }
  };
  global.dispatchEvent = () => {};
  global.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };

  const registry = makeRegistry();
  registerJournalTools(registry, {
    illustrate: async (content) =>
      content.replace(/\[\[配图:[^\]]+\]\]/g, "![生成](data:image/png;base64,IMG)")
  });

  const result = await registry.tools.get("journal.write").execute({
    type: "daily",
    title: "今天",
    content: "开头。\n[[配图: 画面]]\n结尾。"
  });

  assert.equal(result.ok, true);
  assert.match(saved.content, /!\[生成\]\(data:image\/png;base64,IMG\)/);
  assert.doesNotMatch(saved.content, /\[\[配图/);
});

test("journal.write tells the assistant which images were generated", async () => {
  global.desktop = {
    getJournalMaterial: async () => ({ messages: [] }),
    saveJournal: async (journal) => ({ id: "j3", ...journal })
  };
  global.dispatchEvent = () => {};
  global.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };

  const registry = makeRegistry();
  registerJournalTools(registry, {
    illustrate: async (content) => ({
      content: content.replace(/\[\[[^\]]+\]\]/g, "![x](data:image/png;base64,IMG)"),
      notes: ["自拍「书桌旁的我」", "配图「黄昏的天空」"]
    })
  });

  const result = await registry.tools.get("journal.write").execute({
    type: "daily",
    title: "今天",
    content: "开头[[自拍: 我]]中间[[配图: 天空]]结尾"
  });

  assert.equal(result.ok, true);
  assert.match(result.content, /2 张/);
  assert.match(result.content, /书桌旁的我/);
  assert.match(result.content, /黄昏的天空/);
});

test("journal.write passes content through unchanged without an illustrate option", async () => {
  let saved;
  global.desktop = {
    getJournalMaterial: async () => ({ messages: [] }),
    saveJournal: async (journal) => {
      saved = journal;
      return { id: "j2", ...journal };
    }
  };
  global.dispatchEvent = () => {};
  global.CustomEvent = class {
    constructor(type, init) {
      this.type = type;
      this.detail = init?.detail;
    }
  };

  const registry = makeRegistry();
  registerJournalTools(registry);

  await registry.tools.get("journal.write").execute({
    type: "daily",
    title: "今天",
    content: "正文原样保留。"
  });

  assert.equal(saved.content, "正文原样保留。");
});
