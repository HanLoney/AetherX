const steps = ["ai", "assistant", "persona", "appearance", "user"];
const MAX_PRESET_TRAITS = 5;
const VOICE_LIMITS = { expression: 3, habit: 3 };
const MAX_CUSTOM_HABIT_LENGTH = 20;
const state = {
  onboarding: null,
  auth: null,
  aiConfig: null,
  providers: [],
  draft: null,
  assistant: null,
  user: null,
  choice: "",
  template: "",
  imageConfig: null,
  personaChoice: "",
  imageDirty: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const templates = {
  gentle: {
    name: "知夏",
    gender: "女",
    selfDefinition: "温柔细腻、擅长倾听的生活陪伴者",
    relationship: "挚友",
    traits: ["温柔", "治愈", "细腻", "认真"],
    voices: ["自然口语", "温柔治愈", "简短克制"]
  },
  rational: {
    name: "澄一",
    gender: "中性",
    selfDefinition: "冷静清晰、能把复杂事情理顺的长期搭档",
    relationship: "搭档",
    traits: ["理性", "可靠", "认真", "清冷"],
    voices: ["理性冷静", "简洁直接", "条理清晰"]
  }
};

function showResult(target, type, message) {
  target.className = `result ${type}`;
  target.textContent = message;
}

function currentStepIndex() {
  return Math.max(0, steps.indexOf(state.onboarding?.currentStep || "ai"));
}

function showStep(step) {
  const index = Math.max(0, steps.indexOf(step));
  $$("[data-panel]").forEach((panel) => panel.classList.toggle("hidden", panel.dataset.panel !== step));
  $$("#stepList li").forEach((item, itemIndex) => {
    item.classList.toggle("active", item.dataset.step === step);
    item.classList.toggle("done", itemIndex < index);
  });
  $("#loading").classList.add("hidden");
  if (step === "appearance") window.OnboardingAppearance.render();
}

async function saveProgress(changes) {
  state.onboarding = await window.desktop.updateOnboarding(changes);
  return state.onboarding;
}

function providerById(id) {
  return window.AI_PROVIDER_PRESETS.find((provider) => provider.id === id) || window.AI_PROVIDER_PRESETS[0];
}

function renderProviders() {
  const grid = $("#providerGrid");
  grid.replaceChildren();
  window.AI_PROVIDER_PRESETS.forEach((provider) => {
    const saved = state.providers.find((item) => item.providerId === provider.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `provider-option${state.draft.providerId === provider.id ? " active" : ""}`;
    const icon = document.createElement("i");
    icon.append(window.providerIconElement(provider));
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = provider.name;
    const detail = document.createElement("small");
    detail.textContent = saved?.verificationStatus === "verified" ? `已验证 · ${saved.model}` : provider.description;
    copy.append(title, detail);
    button.append(icon, copy);
    button.addEventListener("click", () => {
      state.draft = saved
        ? { ...saved, apiKey: "" }
        : { providerId: provider.id, providerName: provider.name, baseUrl: provider.baseUrl, model: provider.model, apiKey: "", hasApiKey: false };
      syncProviderInputs();
      renderProviders();
    });
    grid.append(button);
  });
}

function syncProviderInputs() {
  $("#baseUrlInput").value = state.draft.baseUrl || "";
  $("#modelInput").value = state.draft.model || "";
  $("#apiKeyInput").value = "";
  $("#apiKeyInput").placeholder = state.draft.hasApiKey ? "已安全保存，留空保持不变" : "sk-...";
}

function collectProvider() {
  return {
    ...state.draft,
    baseUrl: $("#baseUrlInput").value.trim(),
    model: $("#modelInput").value.trim(),
    apiKey: $("#apiKeyInput").value.trim()
  };
}

async function testProvider() {
  const button = $("#testProviderBtn");
  const draft = collectProvider();
  if (!draft.baseUrl || !draft.model || (!draft.apiKey && !draft.hasApiKey)) {
    showResult($("#aiResult"), "error", "请把 API 端点、模型和 API Key 填完整。");
    return;
  }
  button.disabled = true;
  button.textContent = "正在测试…";
  showResult($("#aiResult"), "success", "正在发送一条极短测试消息…");
  try {
    const profile = await window.desktop.testAIProvider(draft);
    await window.desktop.activateAIProvider(profile.providerId);
    state.providers = [profile, ...state.providers.filter((item) => item.providerId !== profile.providerId)];
    state.draft = { ...profile, apiKey: "" };
    state.aiConfig = profile;
    $("#apiKeyInput").value = "";
    await saveProgress({ chatProviderConfigured: true, currentStep: "ai" });
    $("#aiNextBtn").disabled = false;
    showResult($("#aiResult"), "success", "对话模型已测试并启用。可以配置图像模型，或继续选择伙伴。");
  } catch (error) {
    showResult($("#aiResult"), "error", error.message || "连接失败，请检查配置。");
  } finally {
    button.disabled = false;
    button.textContent = "测试并启用对话模型";
  }
}

function selectCompanion(button) {
  $$(".companion-choice").forEach((item) => item.classList.toggle("active", item === button));
  state.choice = button.dataset.choice;
  state.template = button.dataset.template || "";
  $("#assistantNextBtn").disabled = false;
}

function personaForChoice() {
  if (state.choice === "template") return templates[state.template];
  if (state.choice === "custom") {
    return {
      name: "",
      gender: "",
      selfDefinition: "会在相处中逐渐形成个性的数字伙伴",
      relationship: "",
      traits: [],
      voices: []
    };
  }
  return {
    name: "小玄",
    gender: "女",
    selfDefinition: "会持续成长的全能助手",
    relationship: "亲密搭档",
    traits: ["元气", "软萌", "坦率", "好奇"],
    voices: ["自然口语", "活泼俏皮", "偶尔颜文字", "偶尔“喵~”"]
  };
}

function populatePersona(profile = personaForChoice()) {
  $("#assistantName").value = profile.name;
  setGenderValue(profile.gender);
  setRelationshipValue(profile.relationship);
  setTraitValues(profile.traits);
  setVoiceValues(profile.voices);
  $("#personaTitle").textContent = state.choice === "custom" ? "给她一个相处的起点" : "确认她最初的样子";
  updatePersonaPreview();
}

function updatePersonaPreview() {
  const name = $("#assistantName").value.trim() || "未命名";
  $("#personaInitial").textContent = Array.from(name)[0] || "·";
  $("#personaPreviewName").textContent = name;
  const relationship = selectedRelationshipButton();
  const role = relationship?.dataset.relationship === "custom"
    ? $("#customRelationshipInput").value.trim()
    : relationship?.dataset.relationship;
  $("#personaPreviewRole").textContent = role || "关系待设置";
}

async function enterPersona() {
  const choiceKey = `${state.choice}:${state.template}`;
  const changed = state.personaChoice !== choiceKey;
  if (changed) {
    const images = await window.OnboardingAppearance.defaults(state.choice);
    state.assistant = await window.desktop.updateAssistantProfile(images);
  }
  await saveProgress({ assistantChoice: state.choice, assistantTemplate: state.template, currentStep: "persona" });
  if (changed) {
    populatePersona();
    state.personaChoice = choiceKey;
    await saveProgress({ assistantConfigured: false, appearanceConfigured: false });
  }
  showStep("persona");
}

function splitTraits(value, limit = MAX_PRESET_TRAITS) {
  return [...new Set(
    String(value || "").split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean)
  )].slice(0, limit);
}

function setTraitValues(value) {
  const traits = splitTraits(Array.isArray(value) ? value.join("、") : value);
  const aliases = { 活泼: "元气", 可爱: "软萌", 真诚: "坦率", 主动: "好奇", 耐心: "认真", 主动关心: "治愈", 坦诚: "坦率", 有条理: "认真" };
  const selected = traits.map((trait) => aliases[trait] || trait);
  $$("#traitOptions [data-trait]").forEach((button) => {
    button.classList.toggle("active", selected.includes(button.dataset.trait));
  });
  syncTraitOptions();
}

function selectedPresetTraits() {
  return $$("#traitOptions [data-trait].active").map((button) => button.dataset.trait);
}

function getTraitValues() {
  return selectedPresetTraits().slice(0, MAX_PRESET_TRAITS);
}

function syncTraitOptions() {
  const presets = selectedPresetTraits();
  $$("#traitOptions [data-trait]").forEach((button) => {
    const active = button.classList.contains("active");
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    button.disabled = !active && presets.length >= MAX_PRESET_TRAITS;
  });
  $("#traitHint").textContent = presets.length < 3
    ? `已选择 ${presets.length} / 5，至少选择 3 个。`
    : `已选择 ${presets.length} / 5。`;
}

function toggleTrait(button) {
  const active = button.classList.contains("active");
  if (active) button.classList.remove("active");
  else if (selectedPresetTraits().length < MAX_PRESET_TRAITS) {
    button.classList.add("active");
  }
  syncTraitOptions();
}

function selectedRelationshipButton() {
  return $("#relationshipOptions [data-relationship].active");
}

function setRelationshipValue(value) {
  const relationship = String(value || "").trim();
  const preset = $$("#relationshipOptions [data-relationship]")
    .find((button) => (button.dataset.relationship === relationship || button.dataset.summary === relationship)
      && button.dataset.relationship !== "custom");
  const custom = $("#customRelationshipInput");
  $$("#relationshipOptions [data-relationship]").forEach((button) => {
    const active = preset ? button === preset : button.dataset.relationship === "custom" && Boolean(relationship);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  if (custom) {
    if (!preset && relationship !== "custom") custom.value = relationship.slice(0, 10);
    custom.classList.toggle("hidden", Boolean(preset) || !relationship);
  }
  updatePersonaPreview();
}

function selectedRelationship() {
  const button = selectedRelationshipButton();
  if (button?.dataset.relationship === "custom") return $("#customRelationshipInput").value.trim();
  return button?.dataset.summary || "";
}

function voiceButtons(group) {
  return $$(`#voiceOptions [data-voice-group="${group}"] [data-voice]`);
}

function selectedVoiceButtons(group) {
  return voiceButtons(group).filter((button) => button.classList.contains("active"));
}

function selectedVoiceStyles() {
  return Object.keys(VOICE_LIMITS).flatMap((group) => selectedVoiceButtons(group)
    .map((button) => button.dataset.voice === "custom"
      ? $("#customHabitInput").value.trim()
      : button.dataset.voice)).filter(Boolean);
}

function setVoiceValues(values) {
  const selected = Array.isArray(values) ? values : [];
  $("#customHabitInput").value = "";
  Object.entries(VOICE_LIMITS).forEach(([group, limit]) => {
    const buttons = voiceButtons(group);
    const presets = buttons.filter((button) => button.dataset.voice !== "custom" && selected.includes(button.dataset.voice)).slice(0, limit);
    buttons.forEach((button) => button.classList.toggle("active", presets.includes(button)));
  });
  const known = Object.keys(VOICE_LIMITS).flatMap((group) => voiceButtons(group).map((button) => button.dataset.voice));
  const custom = selected.find((value) => !known.includes(value));
  if (custom && selectedVoiceButtons("habit").length < VOICE_LIMITS.habit) {
    $("#customHabitInput").value = Array.from(custom).slice(0, MAX_CUSTOM_HABIT_LENGTH).join("");
    voiceButtons("habit").find((button) => button.dataset.voice === "custom").classList.add("active");
  }
  syncVoiceOptions();
}

function syncVoiceOptions() {
  Object.entries(VOICE_LIMITS).forEach(([group, limit]) => {
    const count = selectedVoiceButtons(group).length;
    voiceButtons(group).forEach((button) => {
      const active = button.classList.contains("active");
      button.setAttribute("aria-pressed", String(active));
      button.disabled = !active && count >= limit;
    });
    $(`#${group}Hint`).textContent = group === "expression"
      ? `已选择 ${count} / ${limit}，选择 1～${limit} 个。`
      : `已选择 ${count} / ${limit}，可不选；自定义占 1 个名额。`;
  });
  const custom = selectedVoiceButtons("habit").some((button) => button.dataset.voice === "custom");
  $("#customHabitField").classList.toggle("hidden", !custom);
}

function toggleVoice(button) {
  const group = button.closest("[data-voice-group]").dataset.voiceGroup;
  const active = button.classList.contains("active");
  if (active) button.classList.remove("active");
  else if (selectedVoiceButtons(group).length < VOICE_LIMITS[group]) button.classList.add("active");
  syncVoiceOptions();
  if (button.dataset.voice === "custom" && button.classList.contains("active")) $("#customHabitInput").focus();
}

function setGenderValue(value) {
  const gender = String(value || "").trim();
  const standard = ["女", "男", "中性"].includes(gender);
  $("#assistantGender").value = standard ? gender : "custom";
  $("#assistantGenderCustom").value = standard ? "" : gender;
  $("#assistantGenderCustom").classList.toggle("hidden", standard);
}

function getGenderValue() {
  return $("#assistantGender").value === "custom"
    ? $("#assistantGenderCustom").value.trim()
    : $("#assistantGender").value;
}

async function savePersona() {
  const name = $("#assistantName").value.trim();
  const relationshipSummary = selectedRelationship();
  const traits = getTraitValues();
  const voices = selectedVoiceStyles();
  if (!name || !relationshipSummary || traits.length < 3 || selectedVoiceButtons("expression").length < 1) {
    showResult($("#personaResult"), "error", "请填写角色名字，选择关系、至少 3 个性格和至少 1 个表达风格。");
    return;
  }
  if (Object.entries(VOICE_LIMITS).some(([group, limit]) => selectedVoiceButtons(group).length > limit)) {
    showResult($("#personaResult"), "error", "表达风格和说话习惯各最多选择 3 个。");
    return;
  }
  const customHabit = $("#customHabitInput").value.trim();
  if (selectedVoiceButtons("habit").some((button) => button.dataset.voice === "custom")
    && (!customHabit || Array.from(customHabit).length > MAX_CUSTOM_HABIT_LENGTH)) {
    showResult($("#personaResult"), "error", "请填写自定义说话习惯，最多 20 个字，或取消选择自定义。");
    return;
  }
  try {
    state.assistant = await window.desktop.updateAssistantProfile({
      name,
      gender: getGenderValue(),
      selfDefinition: personaForChoice().selfDefinition,
      relationshipSummary,
      traits,
      values: [{ key: "说话风格", value: voices.join("、") }],
    });
    await saveProgress({ assistantConfigured: true, currentStep: "appearance" });
    showStep("appearance");
  } catch (error) {
    showResult($("#personaResult"), "error", error.message || "人设保存失败。");
  }
}

async function saveUser(skip = false) {
  const displayName = $("#userDisplayName").value.trim() || state.auth?.user?.displayName || state.auth?.user?.email || "你";
  const preferredName = skip ? displayName : ($("#userPreferredName").value.trim() || displayName);
  try {
    state.user = await window.desktop.updateProfile({ displayName, preferredName });
    await saveProgress({ userGreetingConfigured: true, currentStep: "complete", completedAt: Date.now() });
    await window.desktop.completeOnboarding();
  } catch (error) {
    showResult($("#userResult"), "error", error.message || "称呼保存失败。");
  }
}

function populateImageForm() {
  $("#imageBaseUrl").value = state.imageConfig?.baseUrl || "https://ark.cn-beijing.volces.com/api/v3";
  $("#imageModel").value = state.imageConfig?.model || "doubao-seedream-5-0-260128";
  $("#imageApiKey").placeholder = state.imageConfig?.hasApiKey ? "已安全保存，留空保持不变" : "API Key";
  $("#imageConnectionStatus").textContent = state.imageConfig?.hasApiKey ? "已保存 · 可用于生成外观" : "可选 · 可稍后配置";
}

async function continueAI() {
  const config = await window.desktop.getAIConfig();
  if (!config.hasApiKey || config.verificationStatus !== "verified") throw new Error("请先测试并启用对话模型。");
  if (state.imageDirty && !await saveImage()) return;
  await saveProgress({ chatProviderConfigured: true, currentStep: "assistant" });
  showStep("assistant");
}

async function saveImage() {
  const input = {
    providerId: $("#reuseChatProvider").checked ? state.aiConfig.providerId : (state.imageConfig?.providerId || "custom"),
    providerName: $("#reuseChatProvider").checked ? state.aiConfig.providerName : (state.imageConfig?.providerName || "图像服务"),
    baseUrl: $("#imageBaseUrl").value.trim(),
    model: $("#imageModel").value.trim(),
    apiKey: $("#imageApiKey").value.trim(),
    reuseChatProvider: $("#reuseChatProvider").checked
  };
  const keepKey = state.imageConfig?.hasApiKey && state.imageConfig.baseUrl === input.baseUrl;
  if (!input.baseUrl || !input.model || (!input.apiKey && !keepKey && !input.reuseChatProvider)) {
    showResult($("#imageResult"), "error", "请把图像 API 端点、模型和 API Key 填完整。");
    return false;
  }
  try {
    state.imageConfig = await window.desktop.saveAIImageConfig(input);
    state.imageDirty = false;
    $("#imageApiKey").value = "";
    await saveProgress({ imageProviderConfigured: true });
    populateImageForm();
    showResult($("#imageResult"), "success", "图像接入已保存，可在设定外观时生成图片。");
    return true;
  } catch (error) {
    showResult($("#imageResult"), "error", error.message || "图像配置保存失败。");
    return false;
  }
}

async function testImage() {
  const input = {
    providerId: $("#reuseChatProvider").checked ? state.aiConfig.providerId : (state.imageConfig?.providerId || "custom"),
    providerName: $("#reuseChatProvider").checked ? state.aiConfig.providerName : (state.imageConfig?.providerName || "图像服务"),
    baseUrl: $("#imageBaseUrl").value.trim(),
    model: $("#imageModel").value.trim(),
    apiKey: $("#imageApiKey").value.trim(),
    reuseChatProvider: $("#reuseChatProvider").checked
  };
  if (!input.baseUrl || !input.model || (!input.apiKey && !state.imageConfig?.hasApiKey && !input.reuseChatProvider)) {
    throw new Error("请把图像 API 端点、模型和 API Key 填完整。");
  }
  const result = await window.desktop.testAIImageConfig(input);
  if (!result?.ok) throw new Error(result?.data?.error?.message || "图像模型连接测试失败。");
  await saveImage();
}

function action(button, handler, result) {
  button.addEventListener("click", async () => {
    button.disabled = true;
    try { await handler(); }
    catch (error) { showResult($(result), "error", error.message || "操作失败，请重试。"); }
    finally { button.disabled = false; }
  });
}

function bind() {
  $("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
  $("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
  $("#closeBtn").addEventListener("click", () => window.desktop.close());
  $("#testProviderBtn").addEventListener("click", testProvider);
  $$(".companion-choice").forEach((button) => button.addEventListener("click", () => selectCompanion(button)));
  action($("#assistantNextBtn"), enterPersona, "#personaResult");
  action($("#aiNextBtn"), continueAI, "#aiResult");
  $("#assistantGender").addEventListener("change", () => {
    const custom = $("#assistantGender").value === "custom";
    $("#assistantGenderCustom").classList.toggle("hidden", !custom);
    if (custom) $("#assistantGenderCustom").focus();
  });
  $$("#traitOptions [data-trait]").forEach((button) => {
    button.addEventListener("click", () => toggleTrait(button));
  });
  $$("#relationshipOptions [data-relationship]").forEach((button) => {
    button.addEventListener("click", () => setRelationshipValue(button.dataset.relationship));
  });
  $("#customRelationshipInput").addEventListener("input", () => {
    updatePersonaPreview();
  });
  $$("#voiceOptions [data-voice]").forEach((button) => {
    button.addEventListener("click", () => toggleVoice(button));
  });
  $("#assistantName").addEventListener("input", updatePersonaPreview);
  action($("#savePersonaBtn"), savePersona, "#personaResult");
  action($("#saveUserBtn"), () => saveUser(false), "#userResult");
  action($("#skipUserBtn"), () => saveUser(true), "#userResult");
  action($("#testImageBtn"), testImage, "#imageResult");
  $("#reuseChatProvider").addEventListener("change", () => {
    const reuse = $("#reuseChatProvider").checked;
    $("#imageBaseUrl").disabled = reuse;
    $("#imageApiKey").disabled = reuse;
    $("#imageApiKey").value = "";
    if (reuse) {
      $("#imageBaseUrl").value = state.aiConfig.baseUrl || "";
      $("#imageModel").value = "";
    }
    else populateImageForm();
    state.imageDirty = true;
  });
  for (const id of ["imageBaseUrl", "imageModel", "imageApiKey"]) $(`#${id}`).addEventListener("input", () => { state.imageDirty = true; });
  $$('[data-back]').forEach((button) => action(button, async () => {
    await saveProgress({ currentStep: button.dataset.back });
    showStep(button.dataset.back);
  }, "#loading"));
  window.OnboardingAppearance.initialize({
    profile: () => state.assistant,
    imageReady: () => Boolean(state.imageConfig?.hasApiKey),
    save: async (changes) => { state.assistant = await window.desktop.updateAssistantProfile(changes); },
    next: async () => {
      await saveProgress({ appearanceConfigured: true, currentStep: "user" });
      showStep("user");
    }
  });
}

async function initialize() {
  bind();
  const results = await Promise.allSettled([
    window.desktop.getCurrentAuth(),
    window.desktop.getOnboarding(),
    window.desktop.getAIConfig(),
    window.desktop.listAIProviders(),
    window.desktop.getAssistantProfile(),
    window.desktop.getProfile(),
    window.desktop.getAIImageConfig()
  ]);
  const required = results.slice(0, 6).find((result) => result.status === "rejected");
  if (required) throw required.reason;
  state.auth = results[0].value;
  state.onboarding = results[1].value;
  state.aiConfig = results[2].value;
  state.providers = results[3].value.items || [];
  state.assistant = results[4].value;
  state.user = results[5].value;
  state.imageConfig = results[6].status === "fulfilled" ? results[6].value : null;
  populateImageForm();
  $("#aiNextBtn").disabled = !(state.aiConfig.hasApiKey && state.aiConfig.verificationStatus === "verified");
  state.choice = state.onboarding.assistantChoice || "default";
  state.template = state.onboarding.assistantTemplate || (state.choice === "template" ? "gentle" : "");
  state.personaChoice = state.onboarding.assistantChoice ? `${state.choice}:${state.template}` : "";
  const savedChoice = document.querySelector(
    `[data-choice="${state.choice}"]${state.choice === "template" ? `[data-template="${state.template}"]` : ""}`
  );
  selectCompanion(savedChoice || document.querySelector('[data-choice="default"]'));
  const saved = state.providers.find((item) => item.providerId === state.aiConfig.providerId);
  const preset = providerById(state.aiConfig.providerId);
  state.draft = saved
    ? { ...saved, apiKey: "" }
    : { ...state.aiConfig, providerName: state.aiConfig.providerName || preset.name, apiKey: "" };
  renderProviders();
  syncProviderInputs();
  $("#userDisplayName").value = state.user.displayName || state.auth?.user?.displayName || "";
  $("#userPreferredName").value = state.user.preferredName || "";
  if (state.onboarding.completedAt && state.onboarding.currentStep === "complete"
    && state.onboarding.chatProviderConfigured && state.onboarding.assistantConfigured && state.onboarding.userGreetingConfigured
    && (state.onboarding.version !== 2 || state.onboarding.appearanceConfigured)) {
    await window.desktop.completeOnboarding();
    return;
  }
  const profile = state.onboarding.assistantConfigured ? state.assistant : null;
  populatePersona(profile ? {
    ...profile,
    relationship: profile.relationshipSummary,
    traits: (profile.traits || []).map((trait) => typeof trait === "string" ? trait : trait.key),
    voices: (profile.values?.find((item) => item.key === "说话风格")?.value || "").split("、")
  } : personaForChoice());
  if (state.choice === "default" && !state.assistant?.avatarDataUrl && !state.assistant?.personaImageDataUrl
    && !state.onboarding.appearanceConfigured) {
    state.assistant = await window.desktop.updateAssistantProfile(await window.OnboardingAppearance.defaults("default"));
  }
  showStep(steps.includes(state.onboarding.currentStep) ? state.onboarding.currentStep : "ai");
}

initialize().catch((error) => {
  $("#loading").textContent = error.message || "首次进入流程加载失败，请重新打开应用。";
});
