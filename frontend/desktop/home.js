const SYSTEM_PROMPT =
  "你是小玄，洛尼亲密可靠的 AI 伙伴和编程助手。你可以使用工具管理本地模块。需要读取信息时主动调用工具；需要写入或删除时发起工具调用，客户端会根据用户设置自动同意或在聊天中请求授权。只有收到 ok=true 的工具结果后才能声称操作成功。时间参数必须使用带时区的 ISO 8601 格式。";
const MAX_TOOL_ROUNDS = 6;

class EmptyCompletionError extends Error {
  constructor(message = "接口已响应，但没有返回文本或工具调用") {
    super(message);
    this.name = "EmptyCompletionError";
  }
}

const state = {
  config: null,
  draft: null,
  messages: [],
  modelMessages: [],
  memoryContext: "",
  chatGeneration: 0,
  conversations: [],
  conversationId: null,
  conversationSyncing: false,
  conversationSyncRequested: false,
  restoringConversation: false,
  conversationPromise: null,
  persistedMessageHashes: new Map(),
  pendingApprovals: new Map(),
  connectionStatus: "idle",
  sending: false,
  testing: false
};

function memoryContextMessages() {
  return state.memoryContext
    ? [{ role: "system", content: state.memoryContext }]
    : [];
}

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

const toolRegistry = window.registerTodoTools(
  new window.XuanToolRegistry({
    isEnabled: (toolName) =>
      window.XuanModules.isEnabled(toolName.split(".")[0])
  })
);

const memoryModuleBtn = document.createElement("button");
memoryModuleBtn.id = "memoryModuleBtn";
memoryModuleBtn.className = "nav-item";
memoryModuleBtn.innerHTML = "<i>🧠</i>记忆中心";
document.querySelector("#moduleSettingsBtn").before(memoryModuleBtn);

const historyPanel = document.createElement("section");
historyPanel.className = "history-panel";
historyPanel.innerHTML = `
  <header>
    <span>历史对话</span>
    <button id="newConversationBtn" type="button" title="新对话">＋</button>
  </header>
  <div id="conversationHistoryList" class="history-list"></div>
`;
document.querySelector(".nav-list").after(historyPanel);

const aiNavBtn = document.querySelector(".nav-list .nav-item.active");
const chatWorkspace = document.querySelector(".main");
const moduleViewHost = document.createElement("section");
moduleViewHost.className = "module-view-host hidden";
chatWorkspace.after(moduleViewHost);
const moduleFrame = document.createElement("iframe");
moduleFrame.className = "module-view-frame";
moduleViewHost.append(moduleFrame);
let activeModuleId = "";
let viewTransitionId = 0;
const VIEW_TRANSITION_MS = 220;

function setActiveNavigation(activeButton) {
  [aiNavBtn, document.querySelector("#todoModuleBtn"), memoryModuleBtn,
    document.querySelector("#moduleSettingsBtn")].forEach((button) => {
    button.classList.toggle("active", button === activeButton);
  });
}

function wait(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function nextPaint() {
  return new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))
  );
}

function resetViewAnimationClasses() {
  [chatWorkspace, moduleViewHost].forEach((view) => {
    view.classList.remove("view-entering", "view-leaving");
  });
  moduleFrame.classList.remove("frame-entering", "frame-leaving");
}

async function showChatWorkspace() {
  if (!chatWorkspace.classList.contains("hidden")) {
    setActiveNavigation(aiNavBtn);
    return;
  }
  const transitionId = ++viewTransitionId;
  resetViewAnimationClasses();
  setActiveNavigation(aiNavBtn);
  moduleViewHost.classList.add("view-leaving");
  await wait(VIEW_TRANSITION_MS);
  if (transitionId !== viewTransitionId) return;
  moduleViewHost.classList.add("hidden");
  moduleViewHost.classList.remove("view-leaving", "is-loading");
  chatWorkspace.classList.add("view-entering");
  chatWorkspace.classList.remove("hidden");
  await nextPaint();
  if (transitionId === viewTransitionId) {
    chatWorkspace.classList.remove("view-entering");
  }
}

async function loadModuleFrame(moduleId, source, activeButton, transitionId) {
  if (activeModuleId === moduleId) return;
  moduleViewHost.classList.add("is-loading");
  moduleFrame.classList.add("frame-leaving");
  await wait(140);
  if (transitionId !== viewTransitionId) return;

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      moduleFrame.removeEventListener("load", finish);
      resolve();
    };
    moduleFrame.addEventListener("load", finish, { once: true });
    window.setTimeout(finish, 6000);
    moduleFrame.title = activeButton.textContent.trim();
    moduleFrame.src = `${source}?embedded=1`;
  });
  if (transitionId !== viewTransitionId) return;
  activeModuleId = moduleId;
  moduleFrame.classList.remove("frame-leaving");
  moduleFrame.classList.add("frame-entering");
  moduleViewHost.classList.remove("is-loading");
  await nextPaint();
  if (transitionId === viewTransitionId) {
    moduleFrame.classList.remove("frame-entering");
  }
}

async function showModuleWorkspace(moduleId, source, activeButton) {
  if (
    activeModuleId === moduleId &&
    !moduleViewHost.classList.contains("hidden")
  ) {
    setActiveNavigation(activeButton);
    return;
  }
  const transitionId = ++viewTransitionId;
  resetViewAnimationClasses();
  setActiveNavigation(activeButton);

  const leavingChat = !chatWorkspace.classList.contains("hidden");
  if (leavingChat) {
    chatWorkspace.classList.add("view-leaving");
    await wait(VIEW_TRANSITION_MS);
    if (transitionId !== viewTransitionId) return;
    chatWorkspace.classList.add("hidden");
    chatWorkspace.classList.remove("view-leaving");
    moduleViewHost.classList.add("view-entering");
    moduleViewHost.classList.remove("hidden");
  } else {
    moduleViewHost.classList.remove("hidden");
  }

  await loadModuleFrame(moduleId, source, activeButton, transitionId);
  if (transitionId !== viewTransitionId) return;
  await nextPaint();
  moduleViewHost.classList.remove("view-entering");
}

window.addEventListener("message", (event) => {
  if (
    event.source !== moduleFrame.contentWindow ||
    event.data?.type !== "xuan:navigate"
  ) {
    return;
  }
  const target = event.data.target;
  if (target === "chat") showChatWorkspace();
  if (target === "todo" && window.XuanModules.isEnabled("todo")) {
    showModuleWorkspace(
      "todo",
      "index.html",
      document.querySelector("#todoModuleBtn")
    );
  }
  if (target === "memory" && window.XuanModules.isEnabled("memory")) {
    showModuleWorkspace("memory", "memory.html", memoryModuleBtn);
  }
  if (target === "modules") {
    showModuleWorkspace(
      "modules",
      "modules.html",
      document.querySelector("#moduleSettingsBtn")
    );
  }
});

function syncModuleState() {
  const todoEnabled = window.XuanModules.isEnabled("todo");
  const memoryEnabled = window.XuanModules.isEnabled("memory");
  document.querySelector("#todoModuleBtn").classList.toggle("hidden", !todoEnabled);
  document.querySelector("#todoSuggestion").classList.toggle("hidden", !todoEnabled);
  memoryModuleBtn.classList.toggle("hidden", !memoryEnabled);
}

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
  const content = extractTextContent(result.data);
  if (content) return content;
  throw new Error("接口已响应，但没有返回可读取的文本");
}

function extractTextContent(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || choice?.delta || {};
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part?.text === "string") return part.text;
        if (typeof part?.text?.value === "string") return part.text.value;
        if (typeof part?.content === "string") return part.content;
        return "";
      })
      .join("")
      .trim();
  }
  if (content && typeof content === "object") {
    if (typeof content.text === "string") return content.text.trim();
    if (typeof content.value === "string") return content.value.trim();
  }
  if (typeof choice?.text === "string") return choice.text.trim();
  if (typeof data?.output_text === "string") return data.output_text.trim();
  return "";
}

function extractToolCalls(message) {
  let calls = message?.tool_calls;
  if (typeof calls === "string") {
    try {
      calls = JSON.parse(calls);
    } catch {
      calls = [];
    }
  }
  if (Array.isArray(calls)) {
    return calls
      .filter((call) => call?.function?.name)
      .map((call, index) => ({
        id: String(call.id || `tool-call-${Date.now()}-${index}`),
        type: "function",
        function: {
          name: String(call.function.name),
          arguments:
            typeof call.function.arguments === "string"
              ? call.function.arguments
              : JSON.stringify(call.function.arguments || {})
        }
      }));
  }
  if (message?.function_call?.name) {
    return [
      {
        id: `legacy-call-${Date.now()}`,
        type: "function",
        function: {
          name: String(message.function_call.name),
          arguments:
            typeof message.function_call.arguments === "string"
              ? message.function_call.arguments
              : JSON.stringify(message.function_call.arguments || {})
        }
      }
    ];
  }
  return [];
}

function extractCompletion(result) {
  if (!result?.ok) {
    throw new Error(
      result?.data?.error?.message ||
        result?.data?.message ||
        `请求失败（HTTP ${result?.status || "未知"}）`
    );
  }
  const choice = result.data?.choices?.[0];
  const message = choice?.message || choice?.delta || {};
  const toolCalls = extractToolCalls(message);
  const content = extractTextContent(result.data);
  if (!content && !toolCalls.length) {
    if (choice?.finish_reason === "content_filter") {
      throw new Error("模型响应被内容安全策略拦截");
    }
    throw new EmptyCompletionError();
  }
  return {
    content,
    toolCalls,
    assistantMessage: {
      role: "assistant",
      content: content || null,
      ...(toolCalls.length ? { tool_calls: toolCalls } : {})
    }
  };
}

function isToolCompatibilityError(error) {
  if (error instanceof EmptyCompletionError) return true;
  const message = String(error?.message || "");
  return /(?:tools?|tool_choice|function.?call|函数调用|工具调用).*(?:unsupported|not support|invalid|不支持|无效)/i.test(
    message
  );
}

function toolSummary(tool, rawArguments) {
  let input = {};
  try {
    input = JSON.parse(rawArguments || "{}");
  } catch {
    return `${tool.title}\n参数格式无效`;
  }
  const lines = Object.entries(input)
    .slice(0, 6)
    .map(([key, value]) => `${key}: ${String(value).slice(0, 120)}`);
  return `${tool.risk === "destructive" ? "此操作不可撤销。\n" : ""}${tool.title}\n${lines.join("\n")}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = canonicalize(value[key]);
        return result;
      }, {});
  }
  return value;
}

function toolCallSignature(call) {
  const name = String(call.function?.name || "");
  const rawArguments = call.function?.arguments || "{}";
  try {
    return `${name}:${JSON.stringify(canonicalize(JSON.parse(rawArguments)))}`;
  } catch {
    return `${name}:${rawArguments}`;
  }
}

async function approveToolCall(tool, activity) {
  if (tool.risk === "read") {
    updateToolActivity(activity, "running", "读取中");
    return true;
  }
  if (window.XuanModules.isAutoApproveEnabled()) {
    updateToolActivity(activity, "running", "已自动同意 · 执行中");
    return true;
  }
  updateToolActivity(activity, "waiting", "等待你的允许");
  return new Promise((resolve) => {
    state.pendingApprovals.set(activity.id, { activity, resolve });
    renderMessages();
  });
}

async function finalizeToolRun(summaries, reason) {
  const localSummary =
    summaries.slice(-4).join("\n") || "工具调用已经停止，但没有产生可用结果。";
  try {
    const result = await window.desktop.requestAI({
      ...state.config,
      messages: [
        {
          role: "system",
          content:
            `${SYSTEM_PROMPT}\n工具阶段已经结束，原因：${reason}。` +
            "请严格基于已有工具结果直接给出最终答复，不要再请求任何工具。"
        },
        ...memoryContextMessages(),
        ...state.modelMessages
      ],
      tools: []
    });
    const completion = extractCompletion(result);
    if (completion.content) {
      state.modelMessages.push({
        role: "assistant",
        content: completion.content
      });
      return completion.content;
    }
  } catch {
    // 模型无法收口时使用已执行工具的可信结果，避免再次进入循环。
  }
  const content = `工具阶段已结束，结果如下：\n${localSummary}`;
  state.modelMessages.push({ role: "assistant", content });
  return content;
}

async function runAgentLoop() {
  const seenCalls = new Map();
  const summaries = [];
  let lastCallSignature = "";
  for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
    const request = {
      ...state.config,
      messages: [
        {
          role: "system",
          content: `${SYSTEM_PROMPT}\n当前本地时间：${new Date().toISOString()}`
        },
        ...memoryContextMessages(),
        ...state.modelMessages
      ],
      tools: toolRegistry.modelTools()
    };
    let completion;
    try {
      completion = extractCompletion(await window.desktop.requestAI(request));
    } catch (error) {
      if (!request.tools.length || !isToolCompatibilityError(error)) {
        throw error;
      }
      const fallbackResult = await window.desktop.requestAI({
        ...request,
        messages: [
          {
            role: "system",
            content:
              `${SYSTEM_PROMPT}\n当前端点没有返回工具调用能力。请直接回答用户，` +
              "并明确说明你现在不能读取或修改本地模块，不能假装已执行操作。"
          },
          ...memoryContextMessages(),
          ...state.modelMessages
        ],
        tools: []
      });
      const fallback = extractCompletion(fallbackResult);
      if (!fallback.content || fallback.toolCalls.length) {
        throw new Error("当前模型无法完成普通对话，请更换支持 Chat Completions 的模型");
      }
      state.modelMessages.push(fallback.assistantMessage);
      return `⚠ 当前模型未返回工具调用，本次已降级为普通对话。\n\n${fallback.content}`;
    }
    state.modelMessages.push(completion.assistantMessage);
    if (!completion.toolCalls.length) return completion.content;

    let repeatedCall = false;
    for (const call of completion.toolCalls) {
      const tool = toolRegistry.get(call.function?.name);
      const activity = createToolActivity(tool, call);
      state.messages.push(activity);
      renderMessages();
      let toolResult;
      const signature = toolCallSignature(call);
      const shouldReuse =
        seenCalls.has(signature) &&
        (tool?.risk !== "read" || lastCallSignature === signature);
      if (shouldReuse) {
        const previous = seenCalls.get(signature);
        toolResult = {
          ...previous,
          content: `检测到重复调用，未再次执行。${previous.content}`,
          repeated: true
        };
        activity.detail += `\n\n结果：${toolResult.content}`;
        updateToolActivity(activity, "skipped", "已跳过重复调用");
        repeatedCall = true;
      } else if (!tool) {
        toolResult = toolRegistry.failure(
          "TOOL_NOT_FOUND",
          `未注册工具：${call.function?.name || "未知"}`
        );
        activity.detail += `\n\n结果：${toolResult.content}`;
        updateToolActivity(activity, "error", "工具不可用");
      } else if (!(await approveToolCall(tool, activity))) {
        toolResult = toolRegistry.failure("USER_DENIED", "用户拒绝执行此操作。");
        activity.detail += `\n\n结果：${toolResult.content}`;
        updateToolActivity(activity, "denied", "已拒绝");
      } else {
        elements.composerTip.textContent = `正在执行：${tool.title}`;
        toolResult = await toolRegistry.call(
          call.function?.name,
          call.function?.arguments
        );
        activity.detail += `\n\n结果：${toolResult.content}`;
        updateToolActivity(
          activity,
          toolResult.ok ? "success" : "error",
          toolResult.ok ? "执行成功" : "执行失败"
        );
      }
      if (!shouldReuse) seenCalls.set(signature, toolResult);
      lastCallSignature = signature;
      summaries.push(toolResult.content);
      state.modelMessages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult)
      });
    }
    if (repeatedCall) {
      return finalizeToolRun(summaries, "模型重复请求了相同工具");
    }
  }
  return finalizeToolRun(summaries, `已达到 ${MAX_TOOL_ROUNDS} 轮安全上限`);
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

function historyRecord(message, stream, position) {
  if (!message.id) {
    message.id = `${stream}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  if (!message.createdAt) message.createdAt = Date.now();
  const payload = {};
  Object.entries(message).forEach(([key, value]) => {
    if (!["id", "role", "content"].includes(key)) payload[key] = value;
  });
  return {
    id: message.id,
    stream,
    position,
    role: message.role,
    content: message.content ?? null,
    payload,
    createdAt: message.createdAt
  };
}

function conversationRecords() {
  return [
    ...state.messages.map((message, index) =>
      historyRecord(message, "display", index)
    ),
    ...state.modelMessages.map((message, index) =>
      historyRecord(message, "model", index)
    )
  ];
}

function recordHash(record) {
  return JSON.stringify(record);
}

async function ensureConversation() {
  if (state.conversationId) return state.conversationId;
  if (state.conversationPromise) return state.conversationPromise;
  const firstUserMessage = state.messages.find(
    (message) => message.role === "user"
  );
  if (!firstUserMessage) return null;
  state.conversationPromise = window.desktop
    .createConversation(firstUserMessage.content.slice(0, 60))
    .then((conversation) => {
      state.conversationId = conversation.id;
      return conversation.id;
    })
    .finally(() => {
      state.conversationPromise = null;
    });
  const id = await state.conversationPromise;
  await refreshConversationHistory();
  return id;
}

function scheduleConversationSync() {
  if (state.restoringConversation) return;
  state.conversationSyncRequested = true;
  clearTimeout(scheduleConversationSync.timer);
  scheduleConversationSync.timer = setTimeout(syncConversation, 90);
}

async function syncConversation() {
  if (state.conversationSyncing || state.restoringConversation) return;
  state.conversationSyncing = true;
  try {
    while (state.conversationSyncRequested) {
      state.conversationSyncRequested = false;
      const conversationId = await ensureConversation();
      if (!conversationId) continue;
      const records = conversationRecords();
      const changed = records.filter(
        (record) =>
          state.persistedMessageHashes.get(record.id) !== recordHash(record)
      );
      if (!changed.length) continue;
      await window.desktop.saveConversationMessages(conversationId, changed);
      changed.forEach((record) => {
        state.persistedMessageHashes.set(record.id, recordHash(record));
      });
    }
  } catch (error) {
    console.error("Failed to persist conversation:", error.message);
    clearTimeout(syncConversation.retryTimer);
    syncConversation.retryTimer = setTimeout(() => {
      state.conversationSyncRequested = true;
      syncConversation();
    }, 3000);
  } finally {
    state.conversationSyncing = false;
    if (state.conversationSyncRequested) scheduleConversationSync();
  }
}

async function flushConversationSync() {
  state.conversationSyncRequested = true;
  await syncConversation();
  while (state.conversationSyncing) await wait(20);
}

function renderConversationHistory() {
  const list = document.querySelector("#conversationHistoryList");
  list.replaceChildren();
  state.conversations.forEach((conversation) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "history-item";
    button.classList.toggle("active", conversation.id === state.conversationId);
    const title = document.createElement("strong");
    title.textContent = conversation.title || "新对话";
    const time = document.createElement("small");
    time.textContent = new Intl.DateTimeFormat("zh-CN", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(conversation.updatedAt);
    button.append(title, time);
    button.addEventListener("click", () => loadConversation(conversation.id));
    list.append(button);
  });
  if (!state.conversations.length) {
    const empty = document.createElement("div");
    empty.className = "history-empty";
    empty.textContent = "还没有历史对话";
    list.append(empty);
  }
}

async function refreshConversationHistory() {
  state.conversations = await window.desktop.listConversations();
  renderConversationHistory();
}

async function loadConversation(id) {
  if (state.sending || id === state.conversationId) return;
  await flushConversationSync();
  const result = await window.desktop.getConversation(id);
  state.restoringConversation = true;
  state.conversationId = id;
  state.messages = result.displayMessages || [];
  state.modelMessages = result.modelMessages || [];
  state.memoryContext = "";
  state.pendingApprovals.clear();
  state.persistedMessageHashes.clear();
  conversationRecords().forEach((record) => {
    state.persistedMessageHashes.set(record.id, recordHash(record));
  });
  renderMessages();
  state.restoringConversation = false;
  showChatWorkspace();
  renderConversationHistory();
}

async function startNewConversation() {
  if (state.sending) return;
  await flushConversationSync();
  state.restoringConversation = true;
  state.conversationId = null;
  state.messages = [];
  state.modelMessages = [];
  state.memoryContext = "";
  state.pendingApprovals.clear();
  state.persistedMessageHashes.clear();
  state.chatGeneration += 1;
  renderMessages();
  state.restoringConversation = false;
  showChatWorkspace();
  renderConversationHistory();
}

function createMemoryActivity(kind, items) {
  return {
    id: `memory-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: "memory",
    kind,
    items
  };
}

function createToolActivity(tool, call) {
  return {
    id: `tool-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role: "tool",
    title: tool?.title || call.function?.name || "未知工具",
    detail: tool
      ? toolSummary(tool, call.function?.arguments)
      : `工具：${call.function?.name || "未知"}`,
    risk: tool?.risk || "read",
    status: "queued",
    statusText: "准备调用"
  };
}

function updateToolActivity(activity, status, statusText) {
  activity.status = status;
  activity.statusText = statusText;
  renderMessages();
}

function resolveToolApproval(id, approved) {
  const pending = state.pendingApprovals.get(id);
  if (!pending) return;
  state.pendingApprovals.delete(id);
  updateToolActivity(
    pending.activity,
    approved ? "running" : "denied",
    approved ? "已允许 · 执行中" : "已拒绝"
  );
  pending.resolve(approved);
}

function renderToolActivity(row, message) {
  const card = document.createElement("div");
  card.className = `tool-activity ${message.status}`;

  const head = document.createElement("div");
  head.className = "tool-activity-head";
  const icon = document.createElement("i");
  icon.textContent =
    message.status === "success"
      ? "✓"
      : message.status === "error" || message.status === "denied"
        ? "!"
        : "⌁";
  const title = document.createElement("strong");
  title.textContent = message.title;
  const status = document.createElement("span");
  status.className = "tool-status";
  status.textContent = message.statusText;
  head.append(icon, title, status);

  const detail = document.createElement("pre");
  detail.textContent = message.detail;
  card.append(head, detail);

  if (message.status === "waiting") {
    const actions = document.createElement("div");
    actions.className = "tool-actions";
    const deny = document.createElement("button");
    deny.type = "button";
    deny.className = "tool-deny";
    deny.textContent = "拒绝";
    deny.addEventListener("click", () => resolveToolApproval(message.id, false));
    const approve = document.createElement("button");
    approve.type = "button";
    approve.className = "tool-approve";
    approve.textContent = "允许";
    approve.addEventListener("click", () => resolveToolApproval(message.id, true));
    actions.append(deny, approve);
    card.append(actions);
  }
  row.append(card);
}

function renderMemoryActivity(row, message) {
  const card = document.createElement("div");
  card.className = `memory-activity ${message.kind}`;
  const head = document.createElement("div");
  head.className = "memory-activity-head";
  const title = document.createElement("strong");
  title.textContent = {
    recall: `🧠 本轮参考了 ${message.items.length} 条个人信息`,
    candidate: `✨ 新发现 ${message.items.length} 条候选记忆`,
    confirmed: `✓ 已自动确认 ${message.items.length} 条新记忆`
  }[message.kind];
  const open = document.createElement("button");
  open.type = "button";
  open.textContent =
    message.kind === "candidate"
      ? "去确认"
      : "查看记忆中心";
  open.addEventListener("click", () => {
    showModuleWorkspace("memory", "memory.html", memoryModuleBtn);
  });
  head.append(title, open);
  card.append(head);
  const list = document.createElement("ul");
  message.items.slice(0, 5).forEach((item) => {
    const entry = document.createElement("li");
    entry.textContent = item.content;
    if (item.reason) {
      const reason = document.createElement("small");
      reason.textContent = ` · ${item.reason}`;
      entry.append(reason);
    }
    list.append(entry);
  });
  card.append(list);
  row.append(card);
}

function renderMessages() {
  elements.welcome.classList.toggle("hidden", state.messages.length > 0);
  elements.messageList.replaceChildren();

  state.messages.forEach((message) => {
    const row = document.createElement("div");
    row.className = `message-row ${message.role}`;
    if (message.role === "tool") {
      renderToolActivity(row, message);
      elements.messageList.append(row);
      return;
    }
    if (message.role === "memory") {
      renderMemoryActivity(row, message);
      elements.messageList.append(row);
      return;
    }
    if (message.role === "assistant") {
      const avatar = document.createElement("i");
      avatar.className = "avatar";
      avatar.textContent = "玄";
      row.append(avatar);
    }
    const bubble = document.createElement("div");
    bubble.className = `message-bubble${message.error ? " error" : ""}`;
    if (message.role === "assistant" && !message.error) {
      window.XuanMarkdown.render(bubble, message.content);
    } else {
      bubble.textContent = message.content;
    }
    row.append(bubble);
    elements.messageList.append(row);
  });

  if (state.sending && !state.pendingApprovals.size) {
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
  scheduleConversationSync();
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
  const chatGeneration = state.chatGeneration;
  if (!content || state.sending) return;
  if (!state.config.hasApiKey) {
    openSettings();
    showTestResult("error", "请先完成 AI 配置并测试连接");
    return;
  }

  state.messages.push(createMessage("user", content));
  state.modelMessages.push({ role: "user", content });
  state.memoryContext = "";
  elements.messageInput.value = "";
  elements.sendBtn.disabled = true;
  state.sending = true;
  renderMessages();

  try {
    try {
      const recalled = await window.desktop.recallMemories(content);
      state.memoryContext = recalled.context || "";
      if (recalled.items?.length) {
        state.messages.push(createMemoryActivity("recall", recalled.items));
        renderMessages();
      }
    } catch {
      state.memoryContext = "";
    }
    const response = await runAgentLoop();
    state.messages.push(createMessage("assistant", response));
    state.connectionStatus = "success";
    window.desktop
      .extractMemories({ userMessage: content, assistantMessage: response })
      .then((result) => {
        if (chatGeneration !== state.chatGeneration) return;
        if (result.autoConfirmed?.length) {
          state.messages.push(
            createMemoryActivity(
              "confirmed",
              result.autoConfirmed.map((memory) => ({
                content: memory.content,
                reason: "已自动确认"
              }))
            )
          );
        }
        if (result.candidates?.length) {
          state.messages.push(
            createMemoryActivity(
              "candidate",
              result.candidates.map((candidate) => ({
                content: candidate.content,
                reason:
                  candidate.sensitivity === "sensitive"
                    ? "敏感记忆需手动确认"
                    : "等待洛尼确认"
              }))
            )
          );
        }
        if (!result.autoConfirmed?.length && !result.candidates?.length) return;
        renderMessages();
      })
      .catch(() => {
        // 自动提取失败不影响本轮正常对话。
      });
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
aiNavBtn.addEventListener("click", showChatWorkspace);
document.querySelector("#todoModuleBtn").addEventListener("click", () => {
  if (window.XuanModules.isEnabled("todo")) {
    showModuleWorkspace(
      "todo",
      "index.html",
      document.querySelector("#todoModuleBtn")
    );
  }
});
memoryModuleBtn.addEventListener("click", () => {
  if (window.XuanModules.isEnabled("memory")) {
    showModuleWorkspace("memory", "memory.html", memoryModuleBtn);
  }
});
document.querySelector("#moduleSettingsBtn").addEventListener("click", () => {
  showModuleWorkspace(
    "modules",
    "modules.html",
    document.querySelector("#moduleSettingsBtn")
  );
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
document
  .querySelector("#clearChatBtn")
  .addEventListener("click", startNewConversation);
document
  .querySelector("#newConversationBtn")
  .addEventListener("click", startNewConversation);
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
  syncModuleState();
  renderHeader();
  await refreshConversationHistory();
  if (state.conversations.length) {
    await loadConversation(state.conversations[0].id);
  } else {
    renderMessages();
  }
}

window.addEventListener("xuan:modules-changed", syncModuleState);
window.addEventListener("storage", syncModuleState);

initialize().catch((error) => {
  console.error("Failed to initialize AI configuration:", error.message);
});
