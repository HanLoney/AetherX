const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

test("desktop login routes through a recoverable first-run onboarding page", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "onboarding.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "onboarding.js"), "utf8");
  assert.match(main, /routeAfterAuthentication/);
  assert.match(main, /onboarding\.html/);
  assert.match(main, /isCloudEdition \? "onboarding\.html" : "home\.html"/);
  assert.match(preload, /getOnboarding/);
  assert.match(preload, /completeOnboarding/);
  assert.match(html, /连接对话 AI/);
  assert.match(html, /自定义角色/);
  assert.match(html, /<span>性别<\/span>/);
  assert.match(html, /<option value="女">女<\/option>/);
  assert.match(html, /<option value="男">男<\/option>/);
  assert.match(html, /<option value="中性">中性<\/option>/);
  assert.match(html, /<option value="custom">自定义<\/option>/);
  assert.doesNotMatch(html, /id="assistantDefinition"/);
  assert.doesNotMatch(html, /角色定位/);
  assert.match(script, /testAIProvider/);
  assert.match(script, /updateAssistantProfile/);
  assert.match(script, /getGenderValue/);
  assert.match(script, /completeOnboarding/);
});

test("custom companions start from an empty role image baseline", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "onboarding.js"), "utf8");
  assert.match(script, /state\.choice === "custom"/);
  assert.match(script, /会在相处中逐渐形成个性的数字伙伴/);
  assert.match(script, /avatarDataUrl: "", personaImageDataUrl: ""/);
});
