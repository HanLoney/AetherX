const steps = ["ai", "assistant", "persona", "user", "image"];
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
  imageConfig: null
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const templates = {
  gentle: {
    name: "知夏",
    gender: "女",
    selfDefinition: "温柔细腻、擅长倾听的生活陪伴者",
    relationshipSummary: "与你相互关心、愿意认真听你说话的亲密朋友",
    traits: ["温柔", "细腻", "耐心", "主动关心"],
    voice: "自然、柔和、简短，先回应感受再一起想办法"
  },
  rational: {
    name: "澄一",
    gender: "中性",
    selfDefinition: "冷静清晰、能把复杂事情理顺的长期搭档",
    relationshipSummary: "与你并肩做决定、推进目标的可靠伙伴",
    traits: ["理性", "可靠", "坦诚", "有条理"],
    voice: "清楚、直接、克制，需要时给出可执行步骤"
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
    await saveProgress({ chatProviderConfigured: true, currentStep: "assistant" });
    showStep("assistant");
  } catch (error) {
    showResult($("#aiResult"), "error", error.message || "连接失败，请检查配置。");
  } finally {
    button.disabled = false;
    button.textContent = "测试并启用";
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
    return { name: "", gender: "", selfDefinition: "", relationshipSummary: "", traits: [], voice: "" };
  }
  return {
    name: "小玄",
    gender: "女",
    selfDefinition: "会持续成长的全能助手",
    relationshipSummary: `${state.user?.preferredName || state.user?.displayName || "你"}亲密可靠的数字伙伴`,
    traits: ["活泼", "可爱", "真诚", "主动"],
    voice: "自然、口语化、亲近，句尾偶尔使用“喵~”和颜文字"
  };
}

function populatePersona() {
  const profile = personaForChoice();
  $("#assistantName").value = profile.name;
  setGenderValue(profile.gender);
  $("#assistantDefinition").value = profile.selfDefinition;
  $("#assistantRelationship").value = profile.relationshipSummary;
  $("#assistantTraits").value = profile.traits.join("、");
  $("#assistantVoice").value = profile.voice;
  $("#personaTitle").textContent = state.choice === "custom" ? "从空白开始定义她" : "确认她最初的样子";
  updatePersonaPreview();
}

function updatePersonaPreview() {
  const name = $("#assistantName").value.trim() || "未命名";
  $("#personaInitial").textContent = Array.from(name)[0] || "·";
  $("#personaPreviewName").textContent = name;
  $("#personaPreviewRole").textContent = $("#assistantRelationship").value.trim() || "关系待设置";
}

async function enterPersona() {
  await saveProgress({ assistantChoice: state.choice, assistantTemplate: state.template, currentStep: "persona" });
  populatePersona();
  showStep("persona");
}

function splitTraits(value) {
  return String(value || "").split(/[、,，\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 5);
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
  const relationshipSummary = $("#assistantRelationship").value.trim();
  const selfDefinition = $("#assistantDefinition").value.trim();
  if (!name || !relationshipSummary || !selfDefinition) {
    showResult($("#personaResult"), "error", "请至少填写角色名字、角色定位和与你的关系。");
    return;
  }
  try {
    state.assistant = await window.desktop.updateAssistantProfile({
      name,
      gender: getGenderValue(),
      selfDefinition,
      relationshipSummary,
      traits: splitTraits($("#assistantTraits").value),
      values: $("#assistantVoice").value.trim() ? [`说话风格：${$("#assistantVoice").value.trim()}`] : [],
      ...(state.choice === "custom" ? { avatarDataUrl: "", personaImageDataUrl: "" } : {})
    });
    await saveProgress({ assistantConfigured: true, currentStep: "user" });
    showStep("user");
  } catch (error) {
    showResult($("#personaResult"), "error", error.message || "人设保存失败。");
  }
}

async function saveUser(skip = false) {
  const displayName = $("#userDisplayName").value.trim() || state.auth?.user?.displayName || state.auth?.user?.email || "你";
  const preferredName = skip ? displayName : ($("#userPreferredName").value.trim() || displayName);
  try {
    state.user = await window.desktop.updateProfile({ displayName, preferredName });
    await saveProgress({ userGreetingConfigured: true, currentStep: "image" });
    showStep("image");
  } catch (error) {
    showResult($("#userResult"), "error", error.message || "称呼保存失败。");
  }
}

function revealImageForm() {
  $("#imageForm").classList.remove("hidden");
  $("#saveImageBtn").classList.remove("hidden");
  $("#imageBaseUrl").value = state.imageConfig?.baseUrl || "https://ark.cn-beijing.volces.com/api/v3";
  $("#imageModel").value = state.imageConfig?.model || "doubao-seedream-5-0-260128";
  $("#imageApiKey").placeholder = state.imageConfig?.hasApiKey ? "已安全保存，留空保持不变" : "API Key";
}

async function complete(imageConfigured) {
  await saveProgress({ imageProviderConfigured: imageConfigured, currentStep: "complete" });
  try {
    await window.desktop.completeOnboarding();
  } catch (error) {
    showResult($("#imageResult"), "error", error.message || "首次设置还没有完成。");
  }
}

async function saveImage() {
  const input = {
    providerId: state.imageConfig?.providerId || "volcengine",
    providerName: state.imageConfig?.providerName || "火山方舟",
    baseUrl: $("#imageBaseUrl").value.trim(),
    model: $("#imageModel").value.trim(),
    apiKey: $("#imageApiKey").value.trim()
  };
  if (!input.baseUrl || !input.model || (!input.apiKey && !state.imageConfig?.hasApiKey)) {
    showResult($("#imageResult"), "error", "请把图像 API 端点、模型和 API Key 填完整。");
    return;
  }
  try {
    await window.desktop.saveAIImageConfig(input);
    await complete(true);
  } catch (error) {
    showResult($("#imageResult"), "error", error.message || "图像配置保存失败。");
  }
}

function bind() {
  $("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
  $("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
  $("#closeBtn").addEventListener("click", () => window.desktop.close());
  $("#testProviderBtn").addEventListener("click", testProvider);
  $$(".companion-choice").forEach((button) => button.addEventListener("click", () => selectCompanion(button)));
  $("#assistantNextBtn").addEventListener("click", enterPersona);
  $("#assistantGender").addEventListener("change", () => {
    const custom = $("#assistantGender").value === "custom";
    $("#assistantGenderCustom").classList.toggle("hidden", !custom);
    if (custom) $("#assistantGenderCustom").focus();
  });
  ["#assistantName", "#assistantRelationship"].forEach((selector) => $(selector).addEventListener("input", updatePersonaPreview));
  $("#savePersonaBtn").addEventListener("click", savePersona);
  $("#saveUserBtn").addEventListener("click", () => saveUser(false));
  $("#skipUserBtn").addEventListener("click", () => saveUser(true));
  $("#configureImageBtn").addEventListener("click", revealImageForm);
  $("#skipImageBtn").addEventListener("click", () => complete(false));
  $("#saveImageBtn").addEventListener("click", saveImage);
  $$('[data-back]').forEach((button) => button.addEventListener("click", () => showStep(button.dataset.back)));
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
  state.choice = state.onboarding.assistantChoice || "default";
  state.template = state.onboarding.assistantTemplate || (state.choice === "template" ? "gentle" : "");
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
  if (state.onboarding.completedAt) {
    await window.desktop.completeOnboarding();
    return;
  }
  showStep(steps.includes(state.onboarding.currentStep) ? state.onboarding.currentStep : "ai");
}

initialize().catch((error) => {
  $("#loading").textContent = error.message || "首次进入流程加载失败，请重新打开应用。";
});
