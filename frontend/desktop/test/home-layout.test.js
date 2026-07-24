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

test("desktop exposes a polished global font size setting", () => {
  assert.match(html, /id="interfaceSettingsBtn"/);
  assert.match(html, /id="desktopFontScaleRange"[^>]*min="85"[^>]*max="125"/);
  assert.match(html, /全局字体大小/);
  assert.match(javascript, /applyDesktopFontScale/);
  assert.match(javascript, /aether:font-scale/);
  assert.match(css, /\.interface-settings-panel\s*\{/);
  assert.match(css, /--font-scale/);
});

test("desktop settings expose encrypted export and full restore only", () => {
  assert.match(html, /id="archivePasswordInput"/);
  assert.match(html, /id="exportArchiveBtn"/);
  assert.match(html, /id="restoreArchiveBtn"/);
  assert.match(html, /仅完整恢复/);
  assert.doesNotMatch(html, /合并导入/);
  assert.match(javascript, /window\.desktop\.exportArchive/);
  assert.match(javascript, /window\.desktop\.restoreArchive/);
  assert.match(css, /\.archive-setting\s*\{/);
});
