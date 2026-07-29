const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const desktopRoot = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(desktopRoot, "modules.html"), "utf8");
const css = fs.readFileSync(path.join(desktopRoot, "modules.css"), "utf8");
const script = fs.readFileSync(path.join(desktopRoot, "modules.js"), "utf8");

test("数字生命页面具有唯一标识、生命体征和功能插槽区域", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of [
    "bioshell",
    "assistantAvatar",
    "hubStatus",
    "xuanMoodEcg",
    "xuanMoodBpm",
    "coreAvatar",
    "focusVisual",
    "inspectorColumn",
    "moduleTopology",
    "moduleNodes",
    "activityLinks",
    "selectedActivity",
    "moduleNodeTemplate",
    "selectedModuleToggle"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /mood-heartbeat\.js/);
  assert.doesNotMatch(html, /class="presence-copy"|id="currentMood"|id="vitalMood"/);
  assert.doesNotMatch(html, /coming-soon|MODULES COMING SOON/);
});

test("功能插槽展示真实模块依赖、遥测和选择式配置", () => {
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

test("全部模块使用统一的圆角线性 SVG 图标系统", () => {
  assert.match(script, /const MODULE_ICON_PATHS = Object\.freeze/);
  for (const id of [
    "ai",
    "memory",
    "todo",
    "wallet",
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

test("功能插槽采用独立人格核心和四列扩展背板", () => {
  assert.match(html, /class="presence-panel"/);
  assert.match(html, /class="module-dock"/);
  assert.match(html, /class="inspector-column"/);
  assert.match(html, /class="portrait-stage"/);
  assert.match(html, /FUNCTION SLOTS/);
  assert.doesNotMatch(html, /class="core-axis"/);
  assert.doesNotMatch(html, /class="digital-body"/);
  assert.doesNotMatch(html, /class="neural-links"/);
  assert.match(script, /const MODULE_SLOTS = Object\.freeze/);
  assert.match(script, /node\.classList\.add\("core-module"\)/);
  assert.match(script, /node\.style\.gridColumn = String\(slot\.column\)/);
  assert.match(css, /\.module-node\[data-state="online"\]/);
  assert.match(css, /\.module-node\[data-state="blocked"\]/);
  assert.match(css, /\.module-node::before/);
  assert.match(css, /grid-template-columns:minmax\(118px,\.74fr\) repeat\(4,minmax\(108px,1fr\)\)/);
  assert.match(css, /grid-template-rows:repeat\(3,minmax\(54px,1fr\)\)/);
  assert.match(css, /\.core-module \{ grid-column:1; grid-row:1\/4/);
  assert.match(css, /\.core-module::after \{ content:none; \}/);
  assert.match(css, /\.module-nodes::before/);
  assert.match(css, /@keyframes halo-breathe/);
  assert.match(css, /\.heart-monitor::after/);
  assert.match(css, /@keyframes heart-scan/);
  assert.match(css, /@keyframes slot-signal/);
  assert.match(css, /prefers-reduced-motion/);
});

test("模块间只根据真实调用遥测绘制有方向的数据线", () => {
  assert.match(script, /listModuleActivity/);
  assert.match(script, /mergeModuleActivity/);
  assert.match(script, /activityCursor/);
  assert.match(script, /visibleActivities/);
  assert.match(script, /renderActivityLinks/);
  assert.match(script, /connectionDataPath/);
  assert.match(script, /adjacentCoreConnectionPath/);
  assert.match(script, /orthogonalConnectionRoute/);
  assert.match(script, /roundedOrthogonalPath/);
  assert.match(script, /createActivityFlow/);
  assert.match(script, /pathLength", "100"/);
  assert.match(script, /sourceModuleId/);
  assert.match(script, /targetModuleId/);
  assert.match(script, /new ResizeObserver\(scheduleLinkRender\)/);
  assert.match(script, /setInterval\(refreshModuleActivity, 1_100\)/);
  assert.match(css, /\.data-link\[data-status="running"\]/);
  assert.match(css, /\.data-link-glow/);
  assert.match(css, /\.data-link-flow/);
  assert.match(css, /marker-end:url\(#activityArrow\)/);
  assert.match(css, /@keyframes data-packet/);
  assert.doesNotMatch(css, /\.socket-link/);
});
