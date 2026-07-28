const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(desktopRoot, "modules.html"), "utf8");
const css = fs.readFileSync(path.join(desktopRoot, "modules.css"), "utf8");
const script = fs.readFileSync(path.join(desktopRoot, "modules.js"), "utf8");

test("数字生命舱页面具有唯一标识和完整的生命体征区域", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [
    "bioshell",
    "assistantAvatar",
    "hubStatus",
    "xuanMoodEcg",
    "xuanMoodBpm",
    "currentMood",
    "vitalMood",
    "coreAvatar",
    "focusVisual",
    "inspectorColumn",
    "moduleNodes",
    "moduleNodeTemplate",
    "selectedModuleToggle"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /mood-heartbeat\.js/);
  assert.doesNotMatch(html, /coming-soon|MODULES COMING SOON/);
});

test("义体控制台展示真实模块依赖、遥测和选择式配置", () => {
  assert.match(script, /module\.blockedBy/);
  assert.match(script, /module\.dependencies/);
  assert.match(script, /dataset\.state/);
  assert.match(script, /selectedModuleId/);
  assert.match(script, /focusVisual\.dataset\.state/);
  assert.match(script, /renderInspector/);
  assert.match(script, /getAssistantProfile/);
  assert.match(script, /getXuanMoodHome/);
  assert.match(script, /getTimeAwarenessContext/);
  assert.match(script, /listMemories/);
  assert.match(script, /onSyncChanges/);
  assert.match(script, /setInterval\(refreshTelemetry, 20_000\)/);
});

test("十个模块使用统一的圆角线性 SVG 图标系统", () => {
  assert.match(script, /const MODULE_ICON_PATHS = Object\.freeze/);
  for (const id of [
    "ai",
    "memory",
    "todo",
    "image-generation",
    "time-awareness",
    "xuan-mood",
    "proactive-reminders",
    "autonomous-journal",
    "anniversary-album",
    "dreams"
  ]) {
    assert.match(script, new RegExp(`(?:${id.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}):|"${id}":`));
  }
  assert.match(script, /viewBox="0 0 24 24"/);
  assert.match(css, /stroke-linecap:round/);
  assert.match(css, /stroke-linejoin:round/);
  assert.doesNotMatch(script, /querySelector\("\.node-icon"\)\.textContent = module\.icon/);
});

test("数字生命页面采用生命舞台、义体坞和检查器结构", () => {
  assert.match(html, /class="presence-panel"/);
  assert.match(html, /class="module-dock"/);
  assert.match(html, /class="inspector-column"/);
  assert.match(html, /class="portrait-stage"/);
  assert.doesNotMatch(html, /class="digital-body"/);
  assert.doesNotMatch(html, /class="neural-links"/);
  assert.match(css, /\.module-node\[data-state="online"\]/);
  assert.match(css, /\.module-node\[data-state="blocked"\]/);
  assert.match(css, /@keyframes halo-breathe/);
  assert.match(css, /@keyframes wave/);
  assert.match(css, /prefers-reduced-motion/);
});
