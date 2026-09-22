const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

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
  assert.match(html, /接入图像 AI/);
  assert.match(html, /设定外观/);
  assert.match(html, /id="reuseChatProvider"/);
  assert.match(html, /id="testImageBtn"/);
  assert.match(html, /id="uploadPortraitBtn"/);
  assert.match(html, /id="uploadAvatarBtn"/);
  assert.match(html, /自定义角色/);
  assert.match(html, /<span>性别<\/span>/);
  assert.match(html, /<option value="女">女<\/option>/);
  assert.match(html, /<option value="男">男<\/option>/);
  assert.match(html, /<option value="中性">中性<\/option>/);
  assert.match(html, /<option value="custom">自定义<\/option>/);
  assert.doesNotMatch(html, /id="assistantDefinition"/);
  assert.doesNotMatch(html, /角色定位/);
  assert.match(html, /id="traitOptions"/);
  assert.match(html, /选择 3～5 个/);
  assert.match(html, /id="traitHint"/);
  assert.match(html, /data-trait="温柔"/);
  assert.match(html, /data-trait="理性"/);
  assert.match(html, /data-trait="元气"/);
  assert.match(html, /data-trait="傲娇"/);
  assert.match(html, /data-trait="天然呆"/);
  assert.match(html, /data-trait="小恶魔"/);
  assert.doesNotMatch(html, /id="assistantTraits"/);
  assert.match(html, /id="relationshipOptions"/);
  assert.match(html, /data-relationship="恋人"/);
  assert.match(html, /data-relationship="青梅竹马"/);
  assert.match(html, /data-relationship="学姐"/);
  assert.match(html, /data-relationship="邻桌姐姐"/);
  assert.match(html, /data-relationship="女仆"/);
  assert.match(html, /data-relationship="管家"/);
  assert.match(html, /data-relationship="custom"/);
  assert.match(html, /id="customRelationshipInput" class="hidden" maxlength="10"/);
  assert.doesNotMatch(html, /data-relationship="守护者"/);
  assert.doesNotMatch(html, /data-relationship="家人"/);
  assert.doesNotMatch(html, /data-relationship="搭档"/);
  assert.doesNotMatch(html, /id="assistantRelationship"/);
  assert.match(html, /id="voiceOptions"/);
  assert.match(html, /data-voice="活泼俏皮"/);
  assert.match(html, /data-voice="偶尔“喵~”"/);
  assert.doesNotMatch(html, /id="assistantVoice"/);
  assert.match(script, /testAIProvider/);
  assert.match(script, /updateAssistantProfile/);
  assert.match(script, /getGenderValue/);
  assert.match(script, /toggleTrait/);
  assert.match(script, /MAX_PRESET_TRAITS = 5/);
  assert.match(html, /id="expressionHint"/);
  assert.match(html, /id="habitHint"/);
  assert.match(script, /getTraitValues/);
  assert.match(script, /selectedRelationship/);
  assert.match(script, /customRelationshipInput/);
  assert.match(script, /selectedVoiceStyles/);
  assert.match(script, /completeOnboarding/);
});

test("custom companions start from an empty role image baseline", () => {
  const script = fs.readFileSync(path.join(__dirname, "..", "onboarding.js"), "utf8");
  assert.match(script, /state\.choice === "custom"/);
  assert.match(script, /会在相处中逐渐形成个性的数字伙伴/);
  assert.match(script, /defaults\(state\.choice\)/);
});

function voiceHarness() {
  const html = fs.readFileSync(path.join(__dirname, "..", "onboarding.html"), "utf8");
  const script = fs.readFileSync(path.join(__dirname, "..", "onboarding.js"), "utf8");
  function element(dataset = {}) {
    const classes = new Set();
    return {
      dataset, value: "", disabled: false, textContent: "", attributes: {},
      classList: {
        contains: (name) => classes.has(name),
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        toggle(name, active) { if (active) classes.add(name); else classes.delete(name); }
      },
      setAttribute(name, value) { this.attributes[name] = value; },
      focus() { this.focused = true; }
    };
  }
  const groups = {};
  for (const group of ["expression", "habit"]) {
    const section = html.split(`data-voice-group="${group}"`)[1].split('<small id=')[0];
    groups[group] = [...section.matchAll(/data-voice="([^"]+)"/g)].map((match) => {
      const button = element({ voice: match[1] });
      button.closest = () => ({ dataset: { voiceGroup: group } });
      return button;
    });
  }
  const elements = Object.fromEntries(["expressionHint", "habitHint", "customHabitField", "customHabitInput", "assistantName", "personaResult"]
    .map((id) => [`#${id}`, element()]));
  const saved = [];
  const context = vm.createContext({
    document: {
      querySelector: (selector) => elements[selector],
      querySelectorAll: (selector) => groups[selector.match(/data-voice-group="([^"]+)"/)[1]]
    },
    window: { desktop: { updateAssistantProfile: async (profile) => { saved.push(profile); return profile; }, updateOnboarding: async (changes) => changes } }
  });
  vm.runInContext(script.slice(0, script.lastIndexOf("initialize().catch")), context);
  vm.runInContext('selectedRelationship = () => "挚友"; getTraitValues = () => ["元气", "软萌", "好奇"]; getGenderValue = () => "女"; showStep = () => {};', context);
  elements["#assistantName"].value = "测试伙伴";
  return { context, groups, elements, saved, run: (code) => vm.runInContext(code, context) };
}

test("expression and habit limits are independent and deselection frees only its own group", () => {
  const h = voiceHarness();
  h.run('setVoiceValues(["自然口语", "活泼俏皮", "温柔治愈"])');
  assert.equal(h.groups.expression[3].disabled, true);
  assert.ok(h.groups.habit.every((button) => !button.disabled));
  for (const button of h.groups.habit.slice(0, 3)) h.context.toggleVoice(button);
  assert.equal(h.groups.habit[4].disabled, true);
  h.context.toggleVoice(h.groups.habit[4]);
  assert.equal(h.groups.habit[4].classList.contains("active"), false);
  h.context.toggleVoice(h.groups.habit[0]);
  assert.equal(h.groups.habit[4].disabled, false);
  assert.equal(h.groups.expression[3].disabled, true);
  h.context.toggleVoice(h.groups.expression[0]);
  assert.equal(h.groups.expression[3].disabled, false);
  assert.equal(h.groups.expression[0].attributes["aria-pressed"], "false");
});

test("custom habit requires text, saves the text, and is omitted when deselected", async () => {
  const h = voiceHarness();
  h.run('setVoiceValues(["自然口语"])');
  await h.run("savePersona()");
  assert.equal(h.saved.length, 1, "one expression and no habits are valid");
  const custom = h.groups.habit.find((button) => button.dataset.voice === "custom");
  h.context.toggleVoice(custom);
  assert.equal(h.elements["#customHabitField"].classList.contains("hidden"), false);
  h.elements["#customHabitInput"].value = "   ";
  await h.run("savePersona()");
  assert.equal(h.saved.length, 1);
  h.elements["#customHabitInput"].value = "呀".repeat(21);
  await h.run("savePersona()");
  assert.equal(h.saved.length, 1);
  h.elements["#customHabitInput"].value = "呀".repeat(20);
  await h.run("savePersona()");
  assert.equal(h.saved[1].values[0].value, `自然口语、${"呀".repeat(20)}`);
  h.context.toggleVoice(custom);
  await h.run("savePersona()");
  assert.equal(h.saved[2].values[0].value, "自然口语");
  assert.equal(h.elements["#customHabitField"].classList.contains("hidden"), true);
  h.run('setVoiceValues(["偶尔颜文字", "使用敬语"])');
  await h.run("savePersona()");
  assert.equal(h.saved.length, 3, "habits cannot replace the required expression");
});

test("restored voice settings retain custom habits", () => {
  const h = voiceHarness();
  h.run('setVoiceValues(["自然口语", "使用敬语", "句尾加呀"])');
  assert.equal(h.elements["#customHabitInput"].value, "句尾加呀");
  assert.equal(h.elements["#customHabitField"].classList.contains("hidden"), false);
  assert.equal(h.run('selectedVoiceButtons("habit").length'), 2);
});

test("startup routing rejects false or partial completion and fails closed for Online", async () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const fn = main.slice(main.indexOf("async function routeAfterAuthentication("), main.indexOf("function authenticatedLocalHubApi("));
  const pages = [];
  let state;
  const context = vm.createContext({
    api: { getOnboarding: async () => { if (state instanceof Error) throw state; return state; } },
    openPage: (_sender, page) => pages.push(page),
    isCloudEdition: true, console: { warn() {} }
  });
  vm.runInContext(fn, context);
  for (const input of [
    { completedAt: null, currentStep: "persona" },
    { completedAt: 123, currentStep: "persona", chatProviderConfigured: true, assistantConfigured: true, userGreetingConfigured: true },
    { completedAt: 123, currentStep: "complete", chatProviderConfigured: true, assistantConfigured: true },
    new Error("offline")
  ]) {
    state = input;
    await context.routeAfterAuthentication({});
    assert.equal(pages.at(-1), "onboarding.html");
  }
  state = { completedAt: 123, currentStep: "complete", chatProviderConfigured: true, assistantConfigured: true, userGreetingConfigured: true };
  await context.routeAfterAuthentication({});
  assert.equal(pages.at(-1), "home.html");
});
