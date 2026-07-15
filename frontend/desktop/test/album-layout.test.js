const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "album.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "album.css"), "utf8");
const javascript = fs.readFileSync(path.join(__dirname, "..", "album.js"), "utf8");

test("album page keeps every id unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("album is presented as a paged two-leaf book", () => {
  assert.match(html, /id="albumPrevious"/);
  assert.match(html, /id="albumNext"/);
  assert.match(html, /id="albumPageLabel"/);
  assert.match(html, /src="album-pager\.js"/);
  assert.match(css, /\.moment-card\s*\{[^}]*grid-template-columns:\s*1fr 1fr;/s);
  assert.match(css, /\.moment-card::before/);
  assert.match(javascript, /pager\.move\(offset\)/);
});

test("album sources stay tucked away until the reader opens them", () => {
  assert.match(javascript, /className = "source-list hidden"/);
  assert.match(javascript, /aria-expanded/);
  assert.match(javascript, /sourceList\.classList\.toggle\("hidden", expanded\)/);
  assert.match(css, /\.moment-source-toggle i\s*\{[^}]*transform-origin:\s*50% 50%;/s);
  assert.match(css, /\.moment-source-toggle i::before/);
});
