const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "memory.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "memory.css"), "utf8");
const javascript = fs.readFileSync(path.join(__dirname, "..", "memory.js"), "utf8");

test("memory center keeps every id unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("memory center is structured as a private archive", () => {
  assert.match(html, /class="memory-orbit"/);
  assert.match(html, /class="memory-rules"/);
  assert.match(html, /class="memory-archive"/);
  assert.match(html, /记忆目录/);
  assert.match(css, /\.memory-row::after/);
  assert.match(css, /\.memory-domain-mark/);
});

test("memory records carry domain marks and use personal names", () => {
  assert.match(javascript, /const DOMAIN_ICONS =/);
  assert.match(javascript, /createMemoryMarker/);
  assert.match(javascript, /createElementNS\("http:\/\/www\.w3\.org\/2000\/svg", "svg"\)/);
  assert.match(javascript, /participantNames/);
  assert.match(javascript, /assistantName.*自然想起/);
  assert.doesNotMatch(html, /记录用户与 AI 伙伴/);
});
