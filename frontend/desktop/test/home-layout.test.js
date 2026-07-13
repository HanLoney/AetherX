const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "home.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "home.css"), "utf8");
const javascript = fs.readFileSync(path.join(__dirname, "..", "home.js"), "utf8");

test("sidebar navigation is grouped into clear functional areas", () => {
  ["dailyNavLabel", "spaceNavGroup", "createNavGroup", "systemNavLabel"].forEach(
    (id) => assert.match(html, new RegExp(`id="${id}"`))
  );
  assert.match(javascript, /querySelector\("#spaceNavGroup"\)\.append/);
  assert.match(javascript, /querySelector\("#createNavGroup"\)\.append/);
});

test("sidebar uses compact navigation rows and a distinct active state", () => {
  assert.match(css, /\.nav-item\s*\{[^}]*height:\s*37px;/s);
  assert.match(css, /\.nav-item\.active\s*\{[^}]*linear-gradient/s);
  assert.match(css, /\.nav-group-label\s*\{/);
});

test("functional navigation uses one consistent SVG icon system", () => {
  assert.match(html, /<svg viewBox="0 0 24 24">/);
  assert.match(javascript, /function navIcon\(paths\)/);
  assert.match(css, /\.nav-item i svg\s*\{[^}]*stroke-width:\s*1\.7;/s);
  assert.doesNotMatch(javascript, /<i>[◈◇☾▣]<\/i>/);
});
