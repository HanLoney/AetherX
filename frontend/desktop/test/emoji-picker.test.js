const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  EMOJI_GROUPS,
  insertEmojiAtSelection
} = require("../emoji-picker");

test("emoji insertion preserves surrounding text and moves the caret", () => {
  assert.deepEqual(insertEmojiAtSelection("你好世界", "😊", 2, 2), {
    value: "你好😊世界",
    selectionStart: 4,
    selectionEnd: 4
  });
});

test("emoji insertion replaces the selected range and tolerates missing selection", () => {
  assert.deepEqual(insertEmojiAtSelection("hello", "✨", 1, 4), {
    value: "h✨o",
    selectionStart: 2,
    selectionEnd: 2
  });
  assert.equal(insertEmojiAtSelection("hi", "👋").value, "hi👋");
});

test("emoji groups have unique ids and non-empty choices", () => {
  assert.equal(new Set(EMOJI_GROUPS.map((group) => group.id)).size, EMOJI_GROUPS.length);
  assert.ok(EMOJI_GROUPS.length >= 5);
  assert.ok(EMOJI_GROUPS.every((group) => group.label && group.emojis.length >= 10));
});

test("desktop chat packages and initializes the emoji picker", () => {
  const root = path.join(__dirname, "..");
  const html = fs.readFileSync(path.join(root, "home.html"), "utf8");
  const home = fs.readFileSync(path.join(root, "home.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

  assert.match(html, /id="emojiBtn"/);
  assert.match(html, /id="emojiPicker"/);
  assert.ok(html.indexOf('src="emoji-picker.js"') < html.indexOf('src="home.js"'));
  assert.match(home, /new window\.AetherEmojiPicker/);
  assert.ok(packageJson.build.files.includes("emoji-picker.js"));
});
