const test = require("node:test");
const assert = require("node:assert/strict");
const illustrator = require("../journal-illustrator");
const { AetherJournalWriter } = require("../journal-writer");

test("extracts 配图 and 自拍 placeholders with kind and descriptions", () => {
  const placeholders = illustrator.extractPlaceholders(
    "早上很安静。\n[[配图: 洒进窗户的晨光]]\n然后我入镜。\n[[自拍：站在书桌旁的我]]"
  );
  assert.equal(placeholders.length, 2);
  assert.equal(placeholders[0].description, "洒进窗户的晨光");
  assert.equal(placeholders[0].selfie, false);
  assert.equal(placeholders[1].description, "站在书桌旁的我");
  assert.equal(placeholders[1].selfie, true);
});

test("only own-line placeholders count; inline quotes stay as text", async () => {
  const calls = [];
  const content = await illustrator.illustrate(
    "今天学会了贴图。只要在正文里写上 [[配图: 我想象的画面]] 就行。\n[[配图: 樱花树下]]",
    {
      generateImage: async (payload) => {
        calls.push(payload);
        return { ok: true, images: [{ b64Json: "IMG" }] };
      },
      maxImages: 2
    }
  );
  assert.equal(calls.length, 1);
  assert.match(content, /只要在正文里写上 \[\[配图: 我想象的画面\]\] 就行/);
  assert.match(content, /!\[樱花树下\]/);
});

test("builds a persona-aware prompt only for 自拍 selfies, anime style always", () => {
  const selfie = illustrator.buildPrompt("窗边的我", true);
  const scenery = illustrator.buildPrompt("窗边的猫", false);
  assert.match(selfie, /人设图/);
  assert.doesNotMatch(scenery, /人设图/);
  assert.match(selfie, /二次元/);
  assert.match(scenery, /二次元/);
});

test("passes the persona image only for 自拍 placeholders", async () => {
  const selfiePrompts = [];
  await illustrator.illustrate("开头。\n[[自拍: 站在书桌旁的我]]\n结尾。", {
    generateImage: async (payload) => {
      selfiePrompts.push(payload);
      return { ok: true, images: [{ b64Json: "AAAABBBB" }] };
    },
    personaImage: "data:image/png;base64,PERSONA",
    maxImages: 2
  });
  assert.deepEqual(selfiePrompts[0].image, ["data:image/png;base64,PERSONA"]);

  const scenepPrompts = [];
  await illustrator.illustrate("开头。\n[[配图: 黄昏的天空]]\n结尾。", {
    generateImage: async (payload) => {
      scenepPrompts.push(payload);
      return { ok: true, images: [{ b64Json: "AAAABBBB" }] };
    },
    personaImage: "data:image/png;base64,PERSONA",
    maxImages: 2
  });
  assert.equal(scenepPrompts[0].image, undefined);
});

test("embeds generated base64 images back at the placeholder position", async () => {
  const content = await illustrator.illustrate(
    "开头。\n[[配图: 黄昏的天空]]\n结尾。",
    {
      generateImage: async () => ({ ok: true, images: [{ b64Json: "AAAABBBB" }] }),
      maxImages: 2
    }
  );
  assert.match(content, /!\[黄昏的天空\]\(data:image\/png;base64,AAAABBBB\)/);
  assert.doesNotMatch(content, /\[\[配图/);
});

test("reports every generated image through onImage", async () => {
  const seen = [];
  await illustrator.illustrate(
    "[[自拍: 站在书桌旁的我]]\n[[配图: 黄昏的天空]]",
    {
      generateImage: async () => ({ ok: true, images: [{ b64Json: "IMG" }] }),
      personaImage: "data:image/png;base64,PERSONA",
      maxImages: 2,
      onImage: (info) => seen.push(info)
    }
  );
  assert.deepEqual(seen, [
    { description: "站在书桌旁的我", selfie: true },
    { description: "黄昏的天空", selfie: false }
  ]);
});

test("keeps url images and passes no reference when persona is absent", async () => {
  const prompts = [];
  const content = await illustrator.illustrate("[[配图: 海边]]", {
    generateImage: async (payload) => {
      prompts.push(payload);
      return { ok: true, images: [{ url: "https://cdn.example/a.png" }] };
    },
    personaImage: ""
  });
  assert.equal(prompts[0].image, undefined);
  assert.match(content, /!\[海边\]\(https:\/\/cdn\.example\/a\.png\)/);
});

test("strips placeholders when image generation fails", async () => {
  const content = await illustrator.illustrate("前。\n[[配图: 失败场景]]\n后。", {
    generateImage: async () => ({ ok: false, status: 500 }),
    maxImages: 2
  });
  assert.doesNotMatch(content, /配图|!\[/);
  assert.match(content, /前。/);
  assert.match(content, /后。/);
});

test("respects the maxImages cap and strips the extras", async () => {
  let calls = 0;
  const content = await illustrator.illustrate(
    "[[配图: 一]]\n[[配图: 二]]\n[[配图: 三]]",
    {
      generateImage: async () => {
        calls += 1;
        return { ok: true, images: [{ b64Json: "IMG" }] };
      },
      maxImages: 1
    }
  );
  assert.equal(calls, 1);
  assert.equal((content.match(/!\[/g) || []).length, 1);
  assert.doesNotMatch(content, /\[\[配图/);
});

test("stripAllPlaceholders removes every placeholder without generating", () => {
  const content = illustrator.stripAllPlaceholders(
    "甲\n[[配图: x]]\n乙\n[[配图: y]]\n丙"
  );
  assert.equal(content.replace(/\s/g, ""), "甲乙丙");
});

test("strips hallucinated markdown images but keeps generated base64", async () => {
  const content = await illustrator.illustrate(
    "开头。\n![假图](https://cdn.fake/a.png)\n[[配图: 真实画面]]\n结尾。",
    {
      generateImage: async () => ({ ok: true, images: [{ b64Json: "REAL" }] }),
      maxImages: 2
    }
  );
  assert.doesNotMatch(content, /cdn\.fake/);
  assert.match(content, /!\[真实画面\]\(data:image\/png;base64,REAL\)/);
});

test("stripAllPlaceholders also removes hallucinated markdown images", () => {
  const content = illustrator.stripAllPlaceholders(
    "文字。\n![假图](https://cdn.fake/a.png)\n[[配图: x]]\n结尾。"
  );
  assert.doesNotMatch(content, /cdn\.fake|!\[|配图/);
  assert.match(content, /文字/);
  assert.match(content, /结尾/);
});

test("writer illustrates the journal content when image generation is enabled", async () => {
  let saved;
  const writer = new AetherJournalWriter({
    getJournal: async () => null,
    getMaterial: async () => ({
      messages: [
        {
          conversationTitle: "日常",
          role: "user",
          content: "今天聊了很多",
          createdAt: Date.parse("2026-07-01T10:00:00+08:00")
        }
      ],
      todos: [],
      personalityEvents: [],
      sharedMemories: []
    }),
    saveJournal: async (journal) => {
      saved = journal;
      return { id: "journal-1", ...journal };
    },
    requestAI: async () => ({
      content:
        '{"title":"今天","mood":"温暖","content":"清晨很好。\\n[[配图: 晨光下的书桌]]\\n然后开始工作。"}'
    }),
    extractText: (result) => result.content,
    getSystemPrompt: () => "你是小玄。",
    getRuntime: () => ({}),
    isEnabled: () => true,
    illustrator,
    generateImage: async () => ({ ok: true, images: [{ b64Json: "PHOTO" }] }),
    getPersonaImage: () => "data:image/png;base64,PERSONA",
    isImageEnabled: () => true
  });

  await writer.write({
    type: "daily",
    periodKey: "2026-07-01",
    from: Date.parse("2026-07-01T00:00:00+08:00"),
    to: Date.parse("2026-07-02T00:00:00+08:00")
  });

  assert.match(saved.content, /!\[晨光下的书桌\]\(data:image\/png;base64,PHOTO\)/);
  assert.doesNotMatch(saved.content, /\[\[配图/);
});

test("writer strips placeholders when image generation is disabled", async () => {
  let saved;
  const writer = new AetherJournalWriter({
    getJournal: async () => null,
    getMaterial: async () => ({
      messages: [],
      todos: [],
      personalityEvents: [],
      sharedMemories: []
    }),
    saveJournal: async (journal) => {
      saved = journal;
      return { id: "journal-2", ...journal };
    },
    requestAI: async () => ({
      content: '{"title":"今天","mood":"平静","content":"安静的一天。\\n[[配图: 夜色]]"}'
    }),
    extractText: (result) => result.content,
    getSystemPrompt: () => "你是小玄。",
    getRuntime: () => ({}),
    isEnabled: () => true,
    illustrator,
    generateImage: async () => ({ ok: true, images: [{ b64Json: "X" }] }),
    isImageEnabled: () => false
  });

  await writer.write({
    type: "daily",
    periodKey: "2026-07-02",
    from: Date.parse("2026-07-02T00:00:00+08:00"),
    to: Date.parse("2026-07-03T00:00:00+08:00")
  });

  assert.doesNotMatch(saved.content, /\[\[配图|!\[/);
  assert.match(saved.content, /安静的一天/);
});
