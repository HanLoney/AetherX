if (new URLSearchParams(window.location.search).has("embedded")) {
  document.body.classList.add("embedded");
  if (!window.desktop && window.parent?.desktop) window.desktop = window.parent.desktop;
}

const bioshell = document.querySelector("#bioshell");
const moduleNodes = document.querySelector("#moduleNodes");
const nodeTemplate = document.querySelector("#moduleNodeTemplate");
const todoModuleBtn = document.querySelector("#todoModuleBtn");
const autoApproveInput = document.querySelector("#autoApproveInput");
const selectedModuleToggle = document.querySelector("#selectedModuleToggle");
const focusVisual = document.querySelector("#focusVisual");
const inspectorColumn = document.querySelector("#inspectorColumn");
const telemetry = new Map();
let selectedModuleId = "xuan-mood";
let moodHeartbeat = null;
let refreshTimer = 0;
let refreshQueued = false;
let unsubscribeSync = null;

const MODULE_CODES = Object.freeze({
  ai: "AX-CORE-00", memory: "AX-MEM-12", todo: "AX-SCH-06",
  "image-generation": "AX-VIS-01", "time-awareness": "AX-TIM-00",
  "xuan-mood": "AX-VTL-01", "proactive-reminders": "AX-NOT-00",
  "autonomous-journal": "AX-JRN-03", "anniversary-album": "AX-ARC-05",
  dreams: "AX-REM-03"
});

const MODULE_ICON_PATHS = Object.freeze({
  ai: '<path d="M5 6.5h14v9H9l-4 3v-12Z"/><path d="M8.5 10h5"/><path d="m16.5 2.5.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6Z"/>',
  memory: '<path d="M9 19.5H6.8a2.3 2.3 0 0 1-2.3-2.3v-2.4l-1.2-1.5 1.2-1.1V9.5A6.5 6.5 0 0 1 11 3h1a6 6 0 0 1 6 6v2.8a4.5 4.5 0 0 0 1.5 3.4v4.3H14V17"/><path d="M9 8.5a2 2 0 0 1 3.5-1.3A2 2 0 0 1 16 8.5c0 .8-.4 1.5-1 1.9.6.4 1 1.1 1 1.9a2 2 0 0 1-3.5 1.3A2 2 0 0 1 9 12.3c0-.8.4-1.5 1-1.9-.6-.4-1-1.1-1-1.9Z"/>',
  todo: '<rect x="4.5" y="5.5" width="15" height="14" rx="3"/><path d="M8 3.5v4M16 3.5v4M4.5 9.5h15M8.5 14l2 2 4-4"/>',
  "image-generation": '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="8.5" cy="10" r="1.5"/><path d="m5.5 17 4.5-4 3 2.5 2.5-2 3 3.5"/><path d="m17 1.8.55 1.65 1.65.55-1.65.55L17 6.2l-.55-1.65L14.8 4l1.65-.55Z"/>',
  "time-awareness": '<circle cx="12" cy="12" r="7.5"/><path d="M12 7.5V12l3 2M4 5.5 6.5 3M20 5.5 17.5 3"/><path d="M3 12a9 9 0 0 0 1.3 4.7M21 12a9 9 0 0 1-1.3 4.7"/>',
  "xuan-mood": '<path d="M12 20S4.5 15.5 4.5 9.7A4.2 4.2 0 0 1 12 7.1a4.2 4.2 0 0 1 7.5 2.6C19.5 15.5 12 20 12 20Z"/><path d="M7.5 12h2l1.2-2.3 2.1 5 1.2-2.7h2.5"/>',
  "proactive-reminders": '<path d="M6.5 16.5h11l-1.2-1.8V10a4.3 4.3 0 0 0-8.6 0v4.7l-1.2 1.8Z"/><path d="M10 19a2.2 2.2 0 0 0 4 0M12 3V1.8"/><circle cx="18.5" cy="6" r="2.2"/>',
  "autonomous-journal": '<path d="M4.5 5.5A3.5 3.5 0 0 1 8 3h4v17H8a3.5 3.5 0 0 0-3.5 1V5.5ZM19.5 5.5A3.5 3.5 0 0 0 16 3h-4v17h4a3.5 3.5 0 0 1 3.5 1V5.5Z"/><path d="m15 8 2-2 1 1-2 2-1.5.5Z"/>',
  "anniversary-album": '<rect x="4" y="5" width="14" height="15" rx="3"/><path d="M7 5V3h13v14h-2M7 15l3.2-3 2.3 2 1.8-1.5L16 14"/><path d="M9.2 9.2c.7-1 2.3-.3 1.8.8-.5 1-1.8 1.7-1.8 1.7S7.9 11 7.4 10c-.5-1.1 1.1-1.8 1.8-.8Z"/>',
  dreams: '<path d="M17.8 15.7A7.8 7.8 0 0 1 8.3 6.2a8 8 0 1 0 9.5 9.5Z"/><path d="m17.5 4 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5ZM20 10l.35 1 .95.35-.95.35-.35 1-.35-1-.95-.35.95-.35Z"/>'
});

const MODULE_ACCENTS = Object.freeze({
  ai: "143,135,189",
  memory: "105,159,205",
  todo: "92,174,145",
  "image-generation": "210,132,170",
  "time-awareness": "100,164,210",
  "xuan-mood": "218,126,164",
  "proactive-reminders": "198,146,88",
  "autonomous-journal": "126,145,201",
  "anniversary-album": "194,126,164",
  dreams: "132,122,190"
});

const MODULE_NAVIGATION = Object.freeze({
  todo: ["todo", "index.html"], memory: ["memory", "memory.html"],
  "anniversary-album": ["album", "album.html"], dreams: ["dreams", "dream.html"],
  "image-generation": ["image-generation", "image-generator.html"]
});

function navigate(target, fallback) {
  if (document.body.classList.contains("embedded")) window.parent.postMessage({ type: "xuan:navigate", target }, "*");
  else window.location.href = fallback;
}

function createNavigationButton(id, icon, label) {
  const button = document.createElement("button");
  button.id = `${id}ModuleBtn`;
  button.className = "nav-item";
  button.innerHTML = `<i>${icon}</i>${label}`;
  button.addEventListener("click", () => {
    if (!window.XuanModules.isEnabled(id)) return;
    navigate(...MODULE_NAVIGATION[id]);
  });
  return button;
}

const navigationButtons = new Map([
  ["todo", todoModuleBtn],
  ["memory", createNavigationButton("memory", "◈", "记忆中心")],
  ["anniversary-album", createNavigationButton("anniversary-album", "◇", "我们的纪念册")],
  ["dreams", createNavigationButton("dreams", "☾", "梦境")],
  ["image-generation", createNavigationButton("image-generation", "图", "图像生成")]
]);
todoModuleBtn.after(...[...navigationButtons.values()].slice(1));

function moduleState(module) {
  if (module.core) return "core";
  if (module.blockedBy?.length) return "blocked";
  return module.enabled ? "online" : "offline";
}

function stateLabel(module) {
  if (module.core) return "CORE";
  if (module.blockedBy?.length) return "BLOCKED";
  return module.enabled ? "ONLINE" : "OFFLINE";
}

function defaultTelemetry(module) {
  if (module.blockedBy?.length) return "依赖链断开";
  if (!module.enabled) return "插槽未接入";
  if (module.id === "ai") return "人格核心 / 调度在线";
  if (module.tools) return `${module.tools} 路工具通道`;
  return "状态链路在线";
}

function moduleAccent(module, state = moduleState(module)) {
  if (state === "blocked") return "200,149,93";
  if (state === "offline") return "151,145,160";
  return MODULE_ACCENTS[module.id] || "117,174,224";
}

function moduleIcon(id) {
  const paths = MODULE_ICON_PATHS[id] || MODULE_ICON_PATHS.ai;
  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}

function renderBody() {
  const modules = window.XuanModules.snapshot();
  if (!modules.some((module) => module.id === selectedModuleId)) selectedModuleId = modules[0]?.id || "ai";
  moduleNodes.replaceChildren();

  modules.forEach((module, index) => {
    const state = moduleState(module);
    const node = nodeTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.moduleId = module.id;
    node.dataset.state = state;
    node.dataset.selected = String(module.id === selectedModuleId);
    node.style.setProperty("--node-rgb", moduleAccent(module, state));
    node.querySelector(".node-icon").innerHTML = moduleIcon(module.id);
    node.querySelector(".node-label small").textContent = MODULE_CODES[module.id] || module.id.toUpperCase();
    node.querySelector(".node-label strong").textContent = module.name;
    node.querySelector(".node-state b").textContent = stateLabel(module);
    node.setAttribute("aria-label", `检查${module.name}义体`);
    node.addEventListener("click", () => {
      selectedModuleId = module.id;
      renderBody();
    });
    moduleNodes.append(node);
  });

  const enabled = modules.filter((module) => module.enabled);
  setText("#enabledCount", String(enabled.length));
  setText("#moduleCountLabel", `/ ${modules.length}`);
  setText("#toolCount", String(enabled.reduce((sum, module) => sum + module.tools, 0)).padStart(2, "0"));
  autoApproveInput.checked = window.XuanModules.isAutoApproveEnabled();
  setText("#permissionState", autoApproveInput.checked ? "自动授权" : "逐次确认");
  navigationButtons.forEach((button, id) => button.classList.toggle("hidden", !window.XuanModules.isEnabled(id)));
  renderInspector(modules.find((module) => module.id === selectedModuleId), modules);
}

function renderInspector(module, modules) {
  if (!module) return;
  const state = moduleState(module);
  const selectedState = document.querySelector("#selectedState");
  selectedState.dataset.state = state;
  setText("#selectedStateLabel", stateLabel(module));
  inspectorColumn.dataset.state = state;
  focusVisual.dataset.state = state;
  focusVisual.style.setProperty("--selected-rgb", moduleAccent(module, state));
  document.querySelector("#selectedIcon").innerHTML = moduleIcon(module.id);
  setText("#selectedCode", MODULE_CODES[module.id] || module.id.toUpperCase());
  setText("#selectedName", module.name);
  setText("#selectedDescription", module.description);
  setText("#selectedTelemetry", telemetry.get(module.id) || defaultTelemetry(module));
  setText("#selectedTools", module.tools ? `${module.tools} 路` : "无工具调用");
  setText("#selectedDependencies", dependencyDescription(module, modules));
  setText("#selectedUpdatedAt", module.updatedAt ? formatDateTime(module.updatedAt) : module.core ? "固化核心" : "默认配置");
  setText("#selectedPowerLabel", module.core ? "核心常驻" : module.enabled ? "已接入" : module.blockedBy?.length ? "依赖受阻" : "未接入");
  selectedModuleToggle.checked = module.enabled;
  selectedModuleToggle.disabled = module.core;
  selectedModuleToggle.dataset.moduleId = module.id;

  const warning = document.querySelector("#dependencyWarning");
  if (module.blockedBy?.length) {
    const names = module.blockedBy.map((id) => modules.find((item) => item.id === id)?.name || id);
    warning.querySelector("span").textContent = `需要先接入：${names.join("、")}`;
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
}

function dependencyDescription(module, modules) {
  if (!module.dependencies?.length) return module.core ? "神经总线根节点" : "直接接入人格核心";
  return module.dependencies.map((id) => modules.find((item) => item.id === id)?.name || id).join(" + ");
}

function collectionCount(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.items)) return value.items.length;
  for (const key of ["total", "count", "totalCount"]) if (Number.isFinite(Number(value?.[key]))) return Number(value[key]);
  return 0;
}

async function probeCollection(id, request, noun) {
  if (!window.XuanModules.isEnabled(id) || typeof request !== "function") return;
  try { telemetry.set(id, `${collectionCount(await request())} ${noun}`); }
  catch { telemetry.set(id, "遥测不可用"); }
}

async function refreshProfile() {
  const profile = await window.desktop.getAssistantProfile();
  setText("#assistantName", profile?.name || "小玄");
  setText("#assistantDefinition", profile?.selfDefinition || "会持续成长的数字生命");
  const avatar = document.querySelector("#assistantAvatar");
  const fallback = document.querySelector("#avatarFallback");
  const coreAvatar = document.querySelector("#coreAvatar");
  const coreFallback = document.querySelector("#coreAvatarFallback");
  if (profile?.avatarDataUrl) {
    avatar.src = profile.avatarDataUrl;
    coreAvatar.src = profile.avatarDataUrl;
    fallback.classList.add("hidden");
    coreFallback.classList.add("hidden");
  } else {
    avatar.removeAttribute("src");
    coreAvatar.removeAttribute("src");
    fallback.classList.remove("hidden");
    coreFallback.classList.remove("hidden");
  }
}

async function refreshMood() {
  const monitor = document.querySelector("#moodTelemetry");
  if (!window.XuanModules.isEnabled("xuan-mood")) {
    monitor.dataset.state = "offline";
    moodHeartbeat?.destroy(); moodHeartbeat = null;
    setText("#xuanMoodBpm", "--"); setText("#xuanMoodRhythm", "插槽离线");
    setText("#currentMood", "心绪感知已停用"); setText("#vitalMood", "心绪模块休眠后，她不会记录情绪变化。"); setText("#currentEnergy", "--"); setText("#currentAttention", "--");
    telemetry.set("xuan-mood", "拟生循环已停止");
    return;
  }
  try {
    const snapshot = await window.desktop.getXuanMoodHome();
    const state = snapshot?.state?.state || snapshot?.state || {};
    const bpm = state.physiology?.heartRateBpm;
    monitor.dataset.state = "online";
    const currentMood = state.currentMood || snapshot?.display?.title || "安静感知中";
    setText("#currentMood", currentMood);
    setText("#vitalMood", "她的心绪会随着你们的真实互动持续变化。");
    setText("#currentEnergy", state.energy || "稳定");
    setText("#currentAttention", state.attention || state.focus || "当前对话");
    telemetry.set("xuan-mood", bpm ? `${bpm} BPM / ${state.physiology.rhythm || "steady"}` : "心绪链路在线");
    if (!moodHeartbeat) moodHeartbeat = new window.AetherMoodHeartbeat({ canvas: document.querySelector("#xuanMoodEcg"), bpmElement: document.querySelector("#xuanMoodBpm"), rhythmElement: document.querySelector("#xuanMoodRhythm") });
    moodHeartbeat.setSnapshot(snapshot);
  } catch {
    monitor.dataset.state = "error";
    setText("#xuanMoodBpm", "--"); setText("#xuanMoodRhythm", "状态中断");
    setText("#vitalMood", "暂时无法读取她的心绪变化。");
    telemetry.set("xuan-mood", "生命体征不可用");
  }
}

async function refreshTime() {
  if (!window.XuanModules.isEnabled("time-awareness")) {
    setText("#currentTime", "时间感知已停用"); telemetry.set("time-awareness", "时域同步已关闭"); return;
  }
  try {
    const result = await window.desktop.getTimeAwarenessContext({ now: Date.now(), timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai", locale: navigator.language || "zh-CN" });
    setText("#currentTime", `${result.localTime || "--:--"} · ${result.timeZone || "本地时区"}`);
    telemetry.set("time-awareness", `${result.localTime || "同步"} / ${result.timeZone || "LOCAL"}`);
  } catch { setText("#currentTime", "时域校准失败"); telemetry.set("time-awareness", "时域链路异常"); }
}

async function refreshCollections() {
  await Promise.all([
    probeCollection("memory", () => window.desktop.listMemories({ status: "all" }), "条记忆"),
    probeCollection("todo", () => window.desktop.listTodos({}), "项日程"),
    probeCollection("image-generation", () => window.desktop.getAssistantGallerySummary({}), "张影像"),
    probeCollection("autonomous-journal", () => window.desktop.listJournals({}), "篇手记"),
    probeCollection("anniversary-album", () => window.desktop.listAlbumMoments({ status: "all" }), "段纪念"),
    probeCollection("dreams", () => window.desktop.listDreams({}), "场梦境")
  ]);
  telemetry.set("proactive-reminders", window.XuanModules.isEnabled("proactive-reminders") ? "待办触发链在线" : "提醒回路已关闭");
}

async function refreshTelemetry() {
  if (refreshQueued) return;
  refreshQueued = true;
  try {
    await Promise.allSettled([refreshProfile(), refreshMood(), refreshTime(), refreshCollections()]);
    bioshell.dataset.link = "online";
    setStatusText("神经总线在线"); setText("#hubStatus", "ONLINE"); setText("#lastRefresh", formatClock(Date.now()));
  } catch {
    bioshell.dataset.link = "error";
    setStatusText("神经总线异常"); setText("#hubStatus", "FAULT");
  } finally { refreshQueued = false; renderBody(); }
}

selectedModuleToggle.addEventListener("change", async () => {
  const id = selectedModuleToggle.dataset.moduleId;
  selectedModuleToggle.disabled = true;
  try {
    await window.XuanModules.setEnabled(id, selectedModuleToggle.checked);
    window.parent?.postMessage({ type: "xuan:module-state-changed", id, enabled: window.XuanModules.isEnabled(id) }, "*");
    await refreshTelemetry();
  } catch (error) {
    telemetry.set(id, error.message || "义体配置失败");
    renderBody();
  }
});

autoApproveInput.addEventListener("change", () => {
  window.XuanModules.setAutoApprove(autoApproveInput.checked);
  setText("#permissionState", autoApproveInput.checked ? "自动授权" : "逐次确认");
});

function setText(selector, value) { const element = document.querySelector(selector); if (element) element.textContent = value; }
function setStatusText(value) { const element = document.querySelector("#runtimeStatus"); const beacon = element.querySelector("i"); element.replaceChildren(beacon, document.createTextNode(value)); }
function formatClock(value) { return new Intl.DateTimeFormat("zh-CN", { hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false }).format(value); }
function formatDateTime(value) { return new Intl.DateTimeFormat("zh-CN", { month:"2-digit", day:"2-digit", hour:"2-digit", minute:"2-digit", hour12:false }).format(value); }

document.querySelector("#homeBtn").addEventListener("click", () => navigate("chat", "home.html"));
todoModuleBtn.addEventListener("click", () => { if (window.XuanModules.isEnabled("todo")) navigate("todo", "index.html"); });
document.querySelector("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
document.querySelector("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
document.querySelector("#closeBtn").addEventListener("click", () => window.desktop.close());
window.addEventListener("xuan:modules-changed", () => { renderBody(); void refreshTelemetry(); });
window.addEventListener("xuan:permissions-changed", renderBody);
window.addEventListener("beforeunload", () => { clearInterval(refreshTimer); unsubscribeSync?.(); moodHeartbeat?.destroy(); });

async function initializeModules() {
  await window.XuanModules.hydrate(window.desktop);
  renderBody();
  await refreshTelemetry();
  refreshTimer = setInterval(refreshTelemetry, 20_000);
  if (typeof window.desktop?.onSyncChanges === "function") unsubscribeSync = window.desktop.onSyncChanges(() => setTimeout(refreshTelemetry, 600));
}

initializeModules().catch((error) => {
  bioshell.dataset.link = "error";
  setText("#hubStatus", "FAULT"); setStatusText(error.message || "神经总线异常"); renderBody();
});
