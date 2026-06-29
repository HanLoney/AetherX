const SYSTEM_PROMPT =
  "你是小玄，洛尼亲密可靠的 AI 伙伴和编程助手。回答自然、清楚、真诚，必要时主动给出下一步建议。";

const state = {
  config: null,
  draft: null,
  messages: [],
  connectionStatus: "idle",
  sending: false,
  testing: false
};

const elements = {
  providerLogo: document.querySelector("#providerLogo"),
  providerName: document.querySelector("#providerName"),
  providerModel: document.querySelector("#providerModel"),
  providerCard: document.querySelector("#providerCard"),
  statusPill: document.querySelector("#statusPill"),
  statusLabel: document.querySelector("#statusLabel"),
  welcome: document.querySelector("#welcome"),
  messageList: document.querySelector("#messageList"),
  conversation: document.querySelector("#conversation"),
  messageInput: document.querySelector("#messageInput"),
  sendBtn: document.querySelector("#sendBtn"),
  composerTip: document.querySelector("#composerTip"),
  settingsMask: document.querySelector("#settingsMask"),
  providerGrid: document.querySelector("#providerGrid"),
  baseUrlInput: document.querySelector("#baseUrlInput"),
  apiKeyInput: document.querySelector("#apiKeyInput"),
  modelInput: document.querySelector("#modelInput"),
  keyHelp: document.querySelector("#keyHelp"),
  testResult: document.querySelector("#testResult"),
  testResultText: document.querySelector("#testResult span"),
  testConnectionBtn: document.querySelector("#testConnectionBtn")
};

function providerById(id) {
  return (
    window.AI_PROVIDER_PRESETS.find((provider) => provider.id === id) ||
    window.AI_PROVIDER_PRESETS[0]
  );
}

function validateConfig(config) {
  if (!config.baseUrl.trim()) return "请填写 API 端点";
  if (!/^https?:\/\//i.test(config.baseUrl.trim())) {
    return "API 端点需要以 http:// 或 https:// 开头";
  }
  if (!config.apiKey.trim() && !config.hasApiKey) return "请填写 API Key";
  if (!config.model.trim()) return "请填写模型名称";
  return "";
}

function extractResponse(result) {
  if (!result?.ok) {
    throw new Error(
      result?.data?.error?.message ||
        result?.data?.message ||
        `请求失败（HTTP ${result?.status || "未知"}）`
    );
  }
  const content = result.data?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content.trim();
  if (Array.isArray(content)) {
    const text = content
      .map((part) => (part?.type === "text" ? part.text || "" : ""))
      .join("")
      .trim();
    if (text) return text;
  }
  throw new Error("接口已响应，但没有返回可读取的文本");
}

function renderProviderGrid() {
  elements.providerGrid.replaceChildren();
  window.AI_PROVIDER_PRESETS.forEach((provider) => {
    const button = document.createElement("button");
    button.className = `provider-option${
      state.draft.providerId === provider.id ? " active" : ""
    }`;
    button.type = "button";

    const logo = document.createElement("i");
    logo.textContent = provider.shortName;
    logo.style.background = provider.color;
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = provider.name;
    const description = document.createElement("small");
    description.textContent = provider.description;
    copy.append(name, description);
    button.append(logo, copy);

    button.addEventListener("click", () => {
      const providerChanged = state.draft.providerId !== provider.id;
      state.draft.providerId = provider.id;
      state.draft.providerName = provider.name;
      if (providerChanged) {
        state.draft.apiKey = "";
        state.draft.hasApiKey = false;
        state.connectionStatus = "idle";
      }
      if (provider.id !== "custom") {
        state.draft.baseUrl = provider.baseUrl;
        state.draft.model = provider.model;
      }
      syncDraftInputs();
      renderProviderGrid();
    });
    elements.providerGrid.append(button);
  });
}

function syncDraftInputs() {
  elements.baseUrlInput.value = state.draft.baseUrl;
  elements.modelInput.value = state.draft.model;
  elements.apiKeyInput.value = "";
  elements.apiKeyInput.placeholder = state.draft.hasApiKey
    ? "已安全保存，留空则保持不变"
    : "sk-...";
  elements.keyHelp.textContent = state.draft.hasApiKey
    ? "已有密钥保存在系统安全存储中，输入新值可替换"
    : "密钥使用系统安全存储，不会写入代码仓库";
}

function collectDraft() {
  return {
    ...state.draft,
    baseUrl: elements.baseUrlInput.value.trim(),
    apiKey: elements.apiKeyInput.value.trim(),
    model: elements.modelInput.value.trim()
  };
}

function renderHeader() {
  const provider = providerById(state.config.providerId);
  elements.providerLogo.textContent = provider.shortName;
  elements.providerLogo.style.background = provider.color;
  elements.providerName.textContent = state.config.providerName;
  elements.providerModel.textContent = state.config.model || "未选择模型";
  elements.composerTip.textContent = `当前使用 ${state.config.providerName} · ${
    state.config.model || "未配置模型"
  }`;

  const labels = {
    idle: state.config.hasApiKey ? "等待测试" : "尚未配置",
    success: "已连接",
    error: "连接异常",
    testing: "正在测试"
  };
  elements.statusPill.className = `status-pill ${state.connectionStatus}`;
  elements.statusLabel.textContent = labels[state.connectionStatus];
  document.querySelector("#setupBanner").classList.toggle(
    "hidden",
    state.config.hasApiKey
  );
}

function showTestResult(type, message) {
  elements.testResult.className = `test-result ${type}`;
  elements.testResultText.textContent = message;
}

function openSettings() {
  state.draft = { ...state.config, apiKey: "" };
  renderProviderGrid();
  syncDraftInputs();
  elements.testResult.className = "test-result hidden";
  elements.settingsMask.classList.remove("hidden");
}

function closeSettings() {
  elements.settingsMask.classList.add("hidden");
}

function createMessage(role, content, error = false) {
  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    error
  };
}

function renderMessages() {
  elements.welcome.classList.toggle("hidden", state.messages.length > 0);
  elements.messageList.replaceChildren();

  state.messages.forEach((message) => {
    const row = document.createElement("div");
    row.className = `message-row ${message.role}`;
    if (message.role === "assistant") {
      const avatar = document.createElement("i");
      avatar.className = "avatar";
      avatar.textContent = "玄";
      row.append(avatar);
    }
    const bubble = document.createElement("div");
    bubble.className = `message-bubble${message.error ? " error" : ""}`;
    bubble.textContent = message.content;
    row.append(bubble);
    elements.messageList.append(row);
  });

  if (state.sending) {
    const row = document.createElement("div");
    row.className = "message-row assistant";
    const avatar = document.createElement("i");
    avatar.className = "avatar";
    avatar.textContent = "玄";
    const typing = document.createElement("div");
    typing.className = "message-bubble typing";
    typing.append(
      document.createElement("i"),
      document.createElement("i"),
      document.createElement("i")
    );
    row.append(avatar, typing);
    elements.messageList.append(row);
  }
  elements.conversation.scrollTop = elements.conversation.scrollHeight;
}

async function testConnection() {
  const draft = collectDraft();
  const validationError = validateConfig(draft);
  if (validationError) {
    state.connectionStatus = "error";
    showTestResult("error", validationError);
    renderHeader();
    return;
  }

  state.testing = true;
  state.connectionStatus = "testing";
  elements.testConnectionBtn.disabled = true;
  elements.testConnectionBtn.textContent = "测试中…";
  showTestResult("idle", "正在发送一条极短测试消息…");
  renderHeader();

  try {
    const result = await window.desktop.requestAI({
      ...draft,
      messages: [
        { role: "system", content: "你是连接测试助手。" },
        { role: "user", content: "请只回复：连接成功" }
      ]
    });
    const response = extractResponse(result);
    state.config = await window.desktop.saveAIConfig(draft);
    state.draft = { ...state.config, apiKey: "" };
    state.connectionStatus = "success";
    showTestResult("success", `连接成功：${response}`);
    syncDraftInputs();
  } catch (error) {
    state.connectionStatus = "error";
    showTestResult("error", error.message || "连接失败，请检查配置");
  } finally {
    state.testing = false;
    elements.testConnectionBtn.disabled = false;
    elements.testConnectionBtn.textContent = "测试连接";
    renderHeader();
  }
}

async function saveConfig() {
  const draft = collectDraft();
  const validationError = validateConfig(draft);
  if (validationError) {
    showTestResult("error", validationError);
    return;
  }
  try {
    state.config = await window.desktop.saveAIConfig(draft);
    if (state.connectionStatus !== "success") state.connectionStatus = "idle";
    renderHeader();
    closeSettings();
  } catch (error) {
    showTestResult("error", error.message || "保存失败");
  }
}

async function sendMessage() {
  const content = elements.messageInput.value.trim();
  if (!content || state.sending) return;
  if (!state.config.hasApiKey) {
    openSettings();
    showTestResult("error", "请先完成 AI 配置并测试连接");
    return;
  }

  state.messages.push(createMessage("user", content));
  elements.messageInput.value = "";
  elements.sendBtn.disabled = true;
  state.sending = true;
  renderMessages();

  try {
    const result = await window.desktop.requestAI({
      ...state.config,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...state.messages.map(({ role, content: messageContent }) => ({
          role,
          content: messageContent
        }))
      ]
    });
    state.messages.push(createMessage("assistant", extractResponse(result)));
    state.connectionStatus = "success";
  } catch (error) {
    state.messages.push(
      createMessage(
        "assistant",
        `这次没有连接上：${error.message || "请求失败"}`,
        true
      )
    );
    state.connectionStatus = "error";
  } finally {
    state.sending = false;
    renderHeader();
    renderMessages();
  }
}

document.querySelector("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
document.querySelector("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
document.querySelector("#closeBtn").addEventListener("click", () => window.desktop.close());
document.querySelector("#todoModuleBtn").addEventListener("click", () => {
  window.location.href = "index.html";
});
document.querySelector("#settingsBtn").addEventListener("click", openSettings);
elements.providerCard.addEventListener("click", openSettings);
document.querySelector("#setupBanner").addEventListener("click", openSettings);
document.querySelector("#closeSettingsBtn").addEventListener("click", closeSettings);
document.querySelector("#cancelSettingsBtn").addEventListener("click", closeSettings);
document.querySelector("#testConnectionBtn").addEventListener("click", testConnection);
document.querySelector("#saveConfigBtn").addEventListener("click", saveConfig);
document.querySelector("#showKeyBtn").addEventListener("click", () => {
  const showing = elements.apiKeyInput.type === "text";
  elements.apiKeyInput.type = showing ? "password" : "text";
  document.querySelector("#showKeyBtn").textContent = showing ? "显示" : "隐藏";
});
elements.messageInput.addEventListener("input", () => {
  elements.sendBtn.disabled =
    !elements.messageInput.value.trim() || state.sending;
  elements.messageInput.style.height = "auto";
  elements.messageInput.style.height = `${Math.min(
    elements.messageInput.scrollHeight,
    108
  )}px`;
});
elements.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
});
elements.sendBtn.addEventListener("click", sendMessage);
document.querySelector("#clearChatBtn").addEventListener("click", () => {
  state.messages = [];
  renderMessages();
});
document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    elements.messageInput.value = button.dataset.prompt;
    elements.sendBtn.disabled = false;
    sendMessage();
  });
});
elements.settingsMask.addEventListener("click", (event) => {
  if (event.target === elements.settingsMask) closeSettings();
});

async function initialize() {
  state.config = await window.desktop.getAIConfig();
  state.draft = { ...state.config, apiKey: "" };
  renderHeader();
  renderMessages();
}

initialize().catch((error) => {
  console.error("Failed to initialize AI configuration:", error.message);
});
