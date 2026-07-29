if (new URLSearchParams(window.location.search).has("embedded")) {
  document.body.classList.add("embedded");
  if (!window.desktop && window.parent?.desktop) window.desktop = window.parent.desktop;
}

const bioshell = document.querySelector("#bioshell");
const moduleTopology = document.querySelector("#moduleTopology");
const moduleNodes = document.querySelector("#moduleNodes");
const activityLinks = document.querySelector("#activityLinks");
const activitySummary = document.querySelector("#activitySummary");
const selectedActivity = document.querySelector("#selectedActivity");
const nodeTemplate = document.querySelector("#moduleNodeTemplate");
const todoModuleBtn = document.querySelector("#todoModuleBtn");
const autoApproveInput = document.querySelector("#autoApproveInput");
const selectedModuleToggle = document.querySelector("#selectedModuleToggle");
const focusVisual = document.querySelector("#focusVisual");
const inspectorColumn = document.querySelector("#inspectorColumn");
const telemetry = new Map();
const activityByCall = new Map();

let selectedModuleId = "xuan-mood";
let moduleSnapshot = [];
let moodHeartbeat = null;
let refreshTimer = 0;
let activityTimer = 0;
let linkFrame = 0;
let refreshQueued = false;
let activityPolling = false;
let activityInitialized = false;
let activityCursor = 0;
let unsubscribeSync = null;
let topologyObserver = null;

const ACTIVITY_GLOW_MS = 7_000;
const ACTIVITY_RETENTION_MS = 10 * 60_000;
const ACTIVE_CALL_TIMEOUT_MS = 2 * 60_000;
const SVG_NS = "http://www.w3.org/2000/svg";

const MODULE_SLOTS = Object.freeze({
  memory: { column: 2, row: 1 },
  todo: { column: 3, row: 1 },
  wallet: { column: 4, row: 1 },
  "time-awareness": { column: 5, row: 1 },
  "xuan-mood": { column: 2, row: 2 },
  "image-generation": { column: 3, row: 2 },
  "proactive-reminders": { column: 4, row: 2 },
  "autonomous-journal": { column: 5, row: 2 },
  "anniversary-album": { column: 3, row: 3 },
  dreams: { column: 4, row: 3 }
});

const MODULE_CODES = Object.freeze({
  ai: "AX-CORE-00", memory: "AX-MEM-12", todo: "AX-SCH-06", wallet: "AX-WAL-01",
  "image-generation": "AX-VIS-01", "time-awareness": "AX-TIM-00",
  "xuan-mood": "AX-VTL-01", "proactive-reminders": "AX-NOT-00",
  "autonomous-journal": "AX-JRN-03", "anniversary-album": "AX-ARC-05",
  dreams: "AX-REM-03"
});

const MODULE_ICON_PATHS = Object.freeze({
  ai: '<path d="M5 6.5h14v9H9l-4 3v-12Z"/><path d="M8.5 10h5"/><path d="m16.5 2.5.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6Z"/>',
  memory: '<path d="M9 19.5H6.8a2.3 2.3 0 0 1-2.3-2.3v-2.4l-1.2-1.5 1.2-1.1V9.5A6.5 6.5 0 0 1 11 3h1a6 6 0 0 1 6 6v2.8a4.5 4.5 0 0 0 1.5 3.4v4.3H14V17"/><path d="M9 8.5a2 2 0 0 1 3.5-1.3A2 2 0 0 1 16 8.5c0 .8-.4 1.5-1 1.9.6.4 1 1.1 1 1.9a2 2 0 0 1-3.5 1.3A2 2 0 0 1 9 12.3c0-.8.4-1.5 1-1.9-.6-.4-1-1.1-1-1.9Z"/>',
  todo: '<rect x="4.5" y="5.5" width="15" height="14" rx="3"/><path d="M8 3.5v4M16 3.5v4M4.5 9.5h15M8.5 14l2 2 4-4"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v10a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 17.5v-10Z"/><path d="M4.5 8h11.8A3.2 3.2 0 0 1 19.5 11.2V15H15a3 3 0 0 1 0-6h4.5"/><circle cx="15" cy="12" r=".7"/><path d="M7 5V4.5A1.5 1.5 0 0 1 8.5 3h8"/>',
  "image-generation": '<rect x="3.5" y="5" width="17" height="14" rx="3"/><circle cx="8.5" cy="10" r="1.5"/><path d="m5.5 17 4.5-4 3 2.5 2.5-2 3 3.5"/><path d="m17 1.8.55 1.65 1.65.55-1.65.55L17 6.2l-.55-1.65L14.8 4l1.65-.55Z"/>',
  "time-awareness": '<circle cx="12" cy="12" r="7.5"/><path d="M12 7.5V12l3 2M4 5.5 6.5 3M20 5.5 17.5 3"/><path d="M3 12a9 9 0 0 0 1.3 4.7M21 12a9 9 0 0 1-1.3 4.7"/>',
  "xuan-mood": '<path d="M12 20S4.5 15.5 4.5 9.7A4.2 4.2 0 0 1 12 7.1a4.2 4.2 0 0 1 7.5 2.6C19.5 15.5 12 20 12 20Z"/><path d="M7.5 12h2l1.2-2.3 2.1 5 1.2-2.7h2.5"/>',
  "proactive-reminders": '<path d="M6.5 16.5h11l-1.2-1.8V10a4.3 4.3 0 0 0-8.6 0v4.7l-1.2 1.8Z"/><path d="M10 19a2.2 2.2 0 0 0 4 0M12 3V1.8"/><circle cx="18.5" cy="6" r="2.2"/>',
  "autonomous-journal": '<path d="M4.5 5.5A3.5 3.5 0 0 1 8 3h4v17H8a3.5 3.5 0 0 0-3.5 1V5.5ZM19.5 5.5A3.5 3.5 0 0 0 16 3h-4v17h4a3.5 3.5 0 0 1 3.5 1V5.5Z"/><path d="m15 8 2-2 1 1-2 2-1.5.5Z"/>',
  "anniversary-album": '<rect x="4" y="5" width="14" height="15" rx="3"/><path d="M7 5V3h13v14h-2M7 15l3.2-3 2.3 2 1.8-1.5L16 14"/><path d="M9.2 9.2c.7-1 2.3-.3 1.8.8-.5 1-1.8 1.7-1.8 1.7S7.9 11 7.4 10c-.5-1.1 1.1-1.8 1.8-.8Z"/>',
  dreams: '<path d="M17.8 15.7A7.8 7.8 0 0 1 8.3 6.2a8 8 0 1 0 9.5 9.5Z"/><path d="m17.5 4 .5 1.5 1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5ZM20 10l.35 1 .95.35-.95.35-.35 1-.35-1-.95-.35.95-.35Z"/>'
});

const MODULE_ACCENTS = Object.freeze({
  ai: "143,135,189", memory: "105,159,205", todo: "92,174,145", wallet: "194,151,82",
  "image-generation": "210,132,170", "time-awareness": "100,164,210",
  "xuan-mood": "218,126,164", "proactive-reminders": "198,146,88",
  "autonomous-journal": "126,145,201", "anniversary-album": "194,126,164",
  dreams: "132,122,190"
});

const MODULE_NAVIGATION = Object.freeze({
  todo: ["todo", "index.html"], memory: ["memory", "memory.html"],
  wallet: ["wallet", "wallet.html"],
  "anniversary-album": ["album", "album.html"], dreams: ["dreams", "dream.html"],
  "image-generation": ["image-generation", "image-generator.html"]
});

const ACTIVITY_LABELS = Object.freeze({
  running: "传输中", waiting: "等待中", success: "已完成", error: "异常"
});

function navigate(target, fallback) {
  if (document.body.classList.contains("embedded")) {
    window.parent.postMessage({ type: "xuan:navigate", target }, "*");
  } else {
    window.location.href = fallback;
  }
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
  ["wallet", createNavigationButton("wallet", "¥", "钱包")],
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

function displayName(moduleOrId) {
  const module = typeof moduleOrId === "string"
    ? moduleSnapshot.find((item) => item.id === moduleOrId)
    : moduleOrId;
  if (!module) return String(moduleOrId || "未知模块");
  return module.id === "ai" ? "人格核心" : module.name;
}

function defaultTelemetry(module) {
  if (module.blockedBy?.length) return "运行依赖未启用";
  if (!module.enabled) return "插槽已关闭";
  if (module.id === "ai") return "人格核心在线";
  if (telemetry.has(module.id)) return telemetry.get(module.id);
  return "暂无调用记录";
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
  moduleSnapshot = window.XuanModules.snapshot();
  if (!moduleSnapshot.some((module) => module.id === selectedModuleId)) {
    selectedModuleId = moduleSnapshot[0]?.id || "ai";
  }
  moduleNodes.replaceChildren();

  const ordered = [
    moduleSnapshot.find((module) => module.id === "ai"),
    ...Object.keys(MODULE_SLOTS).map((id) => moduleSnapshot.find((module) => module.id === id))
  ].filter(Boolean);

  ordered.forEach((module) => {
    const state = moduleState(module);
    const node = nodeTemplate.content.firstElementChild.cloneNode(true);
    node.dataset.moduleId = module.id;
    node.dataset.state = state;
    node.dataset.selected = String(module.id === selectedModuleId);
    node.style.setProperty("--node-rgb", moduleAccent(module, state));
    if (module.core) {
      node.classList.add("core-module");
    } else {
      const slot = MODULE_SLOTS[module.id];
      node.dataset.slot = `${slot.column - 1}-${slot.row}`;
      node.style.gridColumn = String(slot.column);
      node.style.gridRow = String(slot.row);
    }
    node.querySelector(".node-icon").innerHTML = moduleIcon(module.id);
    node.querySelector(".node-label small").textContent = MODULE_CODES[module.id] || module.id.toUpperCase();
    node.querySelector(".node-label strong").textContent = displayName(module);
    node.querySelector(".node-state b").textContent = stateLabel(module);
    node.setAttribute("aria-label", `查看${displayName(module)}功能插槽`);
    node.addEventListener("click", () => {
      selectedModuleId = module.id;
      renderBody();
    });
    moduleNodes.append(node);
  });

  const extensions = moduleSnapshot.filter((module) => !module.core);
  const enabled = extensions.filter((module) => module.enabled);
  setText("#enabledCount", String(enabled.length));
  setText("#moduleCountLabel", `/ ${extensions.length}`);
  setText("#toolCount", String(moduleSnapshot.filter((module) => module.enabled).reduce((sum, module) => sum + module.tools, 0)).padStart(2, "0"));
  autoApproveInput.checked = window.XuanModules.isAutoApproveEnabled();
  setText("#permissionState", autoApproveInput.checked ? "自动授权" : "逐次确认");
  navigationButtons.forEach((button, id) => {
    button.classList.toggle("hidden", !window.XuanModules.isEnabled(id));
  });
  renderActivityState();
  renderInspector(moduleSnapshot.find((module) => module.id === selectedModuleId));
  scheduleLinkRender();
}

function renderInspector(module) {
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
  setText("#selectedName", displayName(module));
  setText("#selectedDescription", module.description);
  setText("#selectedTelemetry", activityTelemetry(module) || defaultTelemetry(module));
  setText("#selectedTools", module.tools ? `${module.tools} 路` : "无工具通道");
  setText("#selectedDependencies", dependencyDescription(module));
  setText("#selectedUpdatedAt", module.updatedAt ? formatDateTime(module.updatedAt) : module.core ? "核心常驻" : "默认配置");
  setText("#selectedPowerLabel", module.core ? "始终在线" : module.enabled ? "已启用" : module.blockedBy?.length ? "依赖受阻" : "已关闭");
  selectedModuleToggle.checked = module.enabled;
  selectedModuleToggle.disabled = module.core;
  selectedModuleToggle.dataset.moduleId = module.id;

  const warning = document.querySelector("#dependencyWarning");
  if (module.blockedBy?.length) {
    const names = module.blockedBy.map((id) => displayName(id));
    warning.querySelector("span").textContent = `需要先启用：${names.join("、")}`;
    warning.classList.remove("hidden");
  } else {
    warning.classList.add("hidden");
  }
  renderSelectedActivity(module.id);
}

function dependencyDescription(module) {
  if (!module.dependencies?.length) return module.core ? "调度根节点" : "无强制依赖";
  return module.dependencies.map((id) => displayName(id)).join(" + ");
}

function collectionCount(value) {
  if (Array.isArray(value)) return value.length;
  if (Array.isArray(value?.items)) return value.items.length;
  for (const key of ["total", "count", "totalCount", "accountCount"]) {
    if (Number.isFinite(Number(value?.[key]))) return Number(value[key]);
  }
  return 0;
}

async function probeCollection(id, request, noun) {
  if (!window.XuanModules.isEnabled(id) || typeof request !== "function") return;
  try {
    telemetry.set(id, `${collectionCount(await request())} ${noun}`);
  } catch {
    telemetry.set(id, "遥测不可用");
  }
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
    moodHeartbeat?.destroy();
    moodHeartbeat = null;
    setText("#xuanMoodBpm", "--");
    setText("#xuanMoodRhythm", "模块已关闭");
    telemetry.set("xuan-mood", "心跳已暂停");
    return;
  }
  try {
    const snapshot = await window.desktop.getXuanMoodHome();
    const state = snapshot?.state?.state || snapshot?.state || {};
    const bpm = state.physiology?.heartRateBpm;
    monitor.dataset.state = "online";
    telemetry.set("xuan-mood", bpm ? `${bpm} BPM / ${state.physiology.rhythm || "steady"}` : "心绪状态在线");
    if (!moodHeartbeat) {
      moodHeartbeat = new window.AetherMoodHeartbeat({
        canvas: document.querySelector("#xuanMoodEcg"),
        bpmElement: document.querySelector("#xuanMoodBpm"),
        rhythmElement: document.querySelector("#xuanMoodRhythm")
      });
    }
    moodHeartbeat.setSnapshot(snapshot);
  } catch {
    monitor.dataset.state = "error";
    setText("#xuanMoodBpm", "--");
    setText("#xuanMoodRhythm", "状态中断");
    telemetry.set("xuan-mood", "生命体征不可用");
  }
}

async function refreshTime() {
  if (!window.XuanModules.isEnabled("time-awareness")) {
    telemetry.set("time-awareness", "时域同步已关闭");
    return;
  }
  try {
    const result = await window.desktop.getTimeAwarenessContext({
      now: Date.now(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
      locale: navigator.language || "zh-CN"
    });
    telemetry.set("time-awareness", `${result.localTime || "同步"} / ${result.timeZone || "LOCAL"}`);
  } catch {
    telemetry.set("time-awareness", "时域链路异常");
  }
}

async function refreshCollections() {
  await Promise.all([
    probeCollection("memory", () => window.desktop.listMemories({ status: "all" }), "条记忆"),
    probeCollection("todo", () => window.desktop.listTodos({}), "项日程"),
    probeCollection("wallet", () => window.desktop.getWalletSummary(), "项存款"),
    probeCollection("image-generation", () => window.desktop.getAssistantGallerySummary({}), "张影像"),
    probeCollection("autonomous-journal", () => window.desktop.listJournals({}), "篇手记"),
    probeCollection("anniversary-album", () => window.desktop.listAlbumMoments({ status: "all" }), "段纪念"),
    probeCollection("dreams", () => window.desktop.listDreams({}), "场梦境")
  ]);
  telemetry.set("proactive-reminders", window.XuanModules.isEnabled("proactive-reminders") ? "提醒任务在线" : "提醒任务已关闭");
}

async function refreshTelemetry() {
  if (refreshQueued) return;
  refreshQueued = true;
  try {
    await Promise.allSettled([refreshProfile(), refreshMood(), refreshTime(), refreshCollections()]);
    bioshell.dataset.link = "online";
    setStatusText("Hub 已连接");
    setText("#hubStatus", "ONLINE");
    setText("#lastRefresh", formatClock(Date.now()));
  } catch {
    bioshell.dataset.link = "error";
    setStatusText("Hub 连接异常");
    setText("#hubStatus", "FAULT");
  } finally {
    refreshQueued = false;
    renderBody();
  }
}

function mergeModuleActivity(events = []) {
  for (const event of events) {
    if (!event?.callId) continue;
    const previous = activityByCall.get(event.callId);
    if (previous && isTerminalActivity(previous.status) && !isTerminalActivity(event.status)) {
      continue;
    }
    activityByCall.set(event.callId, {
      ...(previous || {}),
      ...event,
      startedAt: Number(event.startedAt || previous?.startedAt || event.createdAt || Date.now()),
      createdAt: Number(event.createdAt || previous?.createdAt || Date.now())
    });
  }
  const oldest = Date.now() - ACTIVITY_RETENTION_MS;
  for (const [callId, activity] of activityByCall) {
    if (Math.max(activity.createdAt || 0, activity.startedAt || 0) < oldest) {
      activityByCall.delete(callId);
    }
  }
}

async function refreshModuleActivity(initial = false) {
  if (activityPolling || typeof window.desktop?.listModuleActivity !== "function") return;
  activityPolling = true;
  try {
    const filters = initial || !activityInitialized
      ? { limit: 60 }
      : { after: activityCursor, limit: 60 };
    const result = await window.desktop.listModuleActivity(filters);
    mergeModuleActivity(result?.events);
    activityCursor = Number(result?.nextCursor || activityCursor || 0);
    activityInitialized = true;
    renderActivityState();
  } catch {
    activitySummary.dataset.state = "error";
    replaceStatusText(activitySummary, "调用遥测暂不可用");
  } finally {
    activityPolling = false;
  }
}

function isTerminalActivity(status) {
  return status === "success" || status === "error";
}

function recentActivities() {
  return [...activityByCall.values()].sort((left, right) => {
    return (right.createdAt || right.startedAt || 0) - (left.createdAt || left.startedAt || 0);
  });
}

function visibleActivities() {
  const now = Date.now();
  const visible = recentActivities().filter((activity) => {
    const age = now - Number(activity.createdAt || activity.startedAt || now);
    return isTerminalActivity(activity.status)
      ? age <= ACTIVITY_GLOW_MS
      : now - Number(activity.startedAt || now) <= ACTIVE_CALL_TIMEOUT_MS;
  });
  const perDirection = new Map();
  for (const activity of visible) {
    const key = `${activity.sourceModuleId}>${activity.targetModuleId}`;
    const previous = perDirection.get(key);
    if (!previous || activityPriority(activity) > activityPriority(previous)) {
      perDirection.set(key, activity);
    }
  }
  return [...perDirection.values()].sort((left, right) => activityPriority(right) - activityPriority(left)).slice(0, 6);
}

function activityPriority(activity) {
  const statusWeight = { running: 4, waiting: 3, error: 2, success: 1 }[activity.status] || 0;
  return statusWeight * 1e15 + Number(activity.createdAt || activity.startedAt || 0);
}

function renderActivityState() {
  const visible = visibleActivities();
  const nodeStates = new Map();
  for (const activity of visible) {
    for (const id of [activity.sourceModuleId, activity.targetModuleId]) {
      const current = nodeStates.get(id);
      if (!current || activityPriority(activity) > activityPriority(current)) nodeStates.set(id, activity);
    }
  }
  moduleNodes.querySelectorAll(".module-node").forEach((node) => {
    const activity = nodeStates.get(node.dataset.moduleId);
    if (activity) node.dataset.activity = activity.status;
    else delete node.dataset.activity;
  });

  const running = visible.filter((activity) => ["running", "waiting"].includes(activity.status));
  if (running.length) {
    activitySummary.dataset.state = "running";
    replaceStatusText(activitySummary, `${running.length} 路调用进行中`);
  } else if (visible[0]) {
    activitySummary.dataset.state = visible[0].status;
    replaceStatusText(activitySummary, `刚刚完成 · ${shortOperation(visible[0].operation)}`);
  } else {
    activitySummary.dataset.state = "idle";
    replaceStatusText(activitySummary, "等待真实调用");
  }
  const selected = moduleSnapshot.find((module) => module.id === selectedModuleId);
  if (selected) {
    setText("#selectedTelemetry", activityTelemetry(selected) || defaultTelemetry(selected));
    renderSelectedActivity(selected.id);
  }
  scheduleLinkRender();
}

function renderSelectedActivity(moduleId) {
  const activities = recentActivities()
    .filter((activity) => activity.sourceModuleId === moduleId || activity.targetModuleId === moduleId)
    .slice(0, 3);
  if (!activities.length) {
    selectedActivity.innerHTML = "<p>暂时没有调用记录</p>";
    return;
  }
  selectedActivity.replaceChildren(...activities.map((activity) => {
    const row = document.createElement("div");
    row.className = "activity-row";
    row.dataset.status = activity.status;
    const dot = document.createElement("i");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    const timing = document.createElement("time");
    title.textContent = shortOperation(activity.operation);
    const outgoing = activity.sourceModuleId === moduleId;
    detail.textContent = `${outgoing ? "发往" : "来自"} ${displayName(outgoing ? activity.targetModuleId : activity.sourceModuleId)} · ${ACTIVITY_LABELS[activity.status] || activity.status}`;
    timing.textContent = activityTiming(activity);
    copy.append(title, detail);
    row.append(dot, copy, timing);
    return row;
  }));
}

function activityTelemetry(module) {
  const activity = recentActivities().find((item) => {
    return item.sourceModuleId === module.id || item.targetModuleId === module.id;
  });
  if (!activity) return "";
  return `${shortOperation(activity.operation)} · ${activityTiming(activity)}`;
}

function activityTiming(activity) {
  if (activity.status === "running") return "LIVE";
  if (activity.status === "waiting") return "WAIT";
  if (activity.status === "error") return activity.durationMs == null ? "ERR" : `${activity.durationMs} ms`;
  return activity.durationMs == null ? "DONE" : `${activity.durationMs} ms`;
}

function shortOperation(operation) {
  const value = String(operation || "模块调用");
  return value.length > 12 ? `${value.slice(0, 12)}…` : value;
}

function scheduleLinkRender() {
  cancelAnimationFrame(linkFrame);
  linkFrame = requestAnimationFrame(renderActivityLinks);
}

function renderActivityLinks() {
  activityLinks.querySelectorAll(".data-link").forEach((path) => path.remove());
  const topologyRect = moduleTopology.getBoundingClientRect();
  if (!topologyRect.width || !topologyRect.height) return;
  activityLinks.setAttribute("viewBox", `0 0 ${topologyRect.width} ${topologyRect.height}`);
  activityLinks.setAttribute("preserveAspectRatio", "none");

  visibleActivities().forEach((activity) => {
    const source = moduleNodes.querySelector(`[data-module-id="${activity.sourceModuleId}"] .node-icon`);
    const target = moduleNodes.querySelector(`[data-module-id="${activity.targetModuleId}"] .node-icon`);
    if (!source || !target) return;
    const dataPath = connectionDataPath(
      source,
      target,
      source.closest(".module-node"),
      target.closest(".module-node"),
      topologyRect
    );
    const glow = createActivityPath(activity, dataPath, true);
    const path = createActivityPath(activity, dataPath, false);
    const flow = ["running", "waiting"].includes(activity.status)
      ? createActivityFlow(activity, dataPath)
      : null;
    activityLinks.append(...[glow, path, flow].filter(Boolean));
  });
}

function createActivityPath(activity, dataPath, glow) {
    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("data-link");
    if (glow) path.classList.add("data-link-glow");
    path.dataset.status = activity.status;
    path.dataset.callId = activity.callId;
    path.setAttribute("d", dataPath);
    return path;
}

function createActivityFlow(activity, dataPath) {
  const path = createActivityPath(activity, dataPath, false);
  path.classList.add("data-link-flow");
  path.setAttribute("pathLength", "100");
  return path;
}

function portGeometry(element, topologyRect) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left - topologyRect.left + rect.width / 2,
    y: rect.top - topologyRect.top + rect.height / 2,
    radius: Math.max(rect.width, rect.height) / 2 + 3
  };
}

function nodeGeometry(element, topologyRect) {
  const rect = element.getBoundingClientRect();
  return {
    left: rect.left - topologyRect.left,
    right: rect.right - topologyRect.left,
    top: rect.top - topologyRect.top,
    bottom: rect.bottom - topologyRect.top
  };
}

function connectionDataPath(source, target, sourceNode, targetNode, topologyRect) {
  const sourceIsCore = sourceNode.dataset.moduleId === "ai";
  const targetIsCore = targetNode.dataset.moduleId === "ai";
  const extensionNode = sourceIsCore ? targetNode : targetIsCore ? sourceNode : null;
  const extensionColumn = Number(String(extensionNode?.dataset.slot || "").split("-")[0]);
  if (extensionNode && extensionColumn === 1) {
    return adjacentCoreConnectionPath(
      portGeometry(source, topologyRect),
      portGeometry(target, topologyRect)
    );
  }
  return roundedOrthogonalPath(
    orthogonalConnectionRoute(source, target, sourceNode, targetNode, topologyRect),
    7
  );
}

function adjacentCoreConnectionPath(fromPort, toPort) {
  const dx = toPort.x - fromPort.x;
  const dy = toPort.y - fromPort.y;
  const distance = Math.max(1, Math.hypot(dx, dy));
  const ux = dx / distance;
  const uy = dy / distance;
  const from = {
    x: fromPort.x + ux * fromPort.radius,
    y: fromPort.y + uy * fromPort.radius
  };
  const to = {
    x: toPort.x - ux * toPort.radius,
    y: toPort.y - uy * toPort.radius
  };
  const direction = Math.sign(to.x - from.x) || 1;
  const bend = Math.max(12, Math.abs(to.x - from.x) * .46);
  return `M ${from.x} ${from.y} C ${from.x + direction * bend} ${from.y}, ${to.x - direction * bend} ${to.y}, ${to.x} ${to.y}`;
}

function orthogonalConnectionRoute(source, target, sourceNode, targetNode, topologyRect) {
  const fromPort = portGeometry(source, topologyRect);
  const toPort = portGeometry(target, topologyRect);
  const fromNode = nodeGeometry(sourceNode, topologyRect);
  const toNode = nodeGeometry(targetNode, topologyRect);
  const sourceSide = sourceNode.dataset.moduleId === "ai" ? 1 : -1;
  const targetSide = targetNode.dataset.moduleId === "ai" ? 1 : -1;
  const from = {
    x: fromPort.x + sourceSide * fromPort.radius,
    y: fromPort.y
  };
  const to = {
    x: toPort.x + targetSide * toPort.radius,
    y: toPort.y
  };
  const sourceRailX = sourceSide > 0 ? fromNode.right + 5 : fromNode.left - 5;
  const targetRailX = targetSide > 0 ? toNode.right + 5 : toNode.left - 5;
  let laneY;
  if (Math.abs(from.y - to.y) < 12) {
    laneY = Math.min(fromNode.top, toNode.top) - 6;
  } else if (to.y < from.y) {
    laneY = fromNode.top - 6;
  } else {
    laneY = fromNode.bottom + 6;
  }
  laneY = Math.max(7, Math.min(topologyRect.height - 7, laneY));
  return compactPoints([
    from,
    { x: sourceRailX, y: from.y },
    { x: sourceRailX, y: laneY },
    { x: targetRailX, y: laneY },
    { x: targetRailX, y: to.y },
    to
  ]);
}

function compactPoints(points) {
  return points.filter((point, index) => {
    if (!index) return true;
    const previous = points[index - 1];
    return Math.abs(point.x - previous.x) > .5 || Math.abs(point.y - previous.y) > .5;
  });
}

function roundedOrthogonalPath(points, radius) {
  if (points.length < 2) return "";
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const corner = points[index];
    const next = points[index + 1];
    const incoming = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const outgoing = Math.hypot(next.x - corner.x, next.y - corner.y);
    const curve = Math.min(radius, incoming / 2, outgoing / 2);
    if (!curve) {
      path += ` L ${corner.x} ${corner.y}`;
      continue;
    }
    const before = {
      x: corner.x + (previous.x - corner.x) * (curve / incoming),
      y: corner.y + (previous.y - corner.y) * (curve / incoming)
    };
    const after = {
      x: corner.x + (next.x - corner.x) * (curve / outgoing),
      y: corner.y + (next.y - corner.y) * (curve / outgoing)
    };
    path += ` L ${before.x} ${before.y} Q ${corner.x} ${corner.y} ${after.x} ${after.y}`;
  }
  const last = points.at(-1);
  return `${path} L ${last.x} ${last.y}`;
}

selectedModuleToggle.addEventListener("change", async () => {
  const id = selectedModuleToggle.dataset.moduleId;
  selectedModuleToggle.disabled = true;
  try {
    await window.XuanModules.setEnabled(id, selectedModuleToggle.checked);
    window.parent?.postMessage({ type: "xuan:module-state-changed", id, enabled: window.XuanModules.isEnabled(id) }, "*");
    await refreshTelemetry();
  } catch (error) {
    telemetry.set(id, error.message || "模块配置失败");
    renderBody();
  }
});

autoApproveInput.addEventListener("change", async () => {
  autoApproveInput.disabled = true;
  try {
    await window.XuanModules.setAutoApprove(autoApproveInput.checked);
  } catch (error) {
    telemetry.set(selectedModuleId, error.message || "授权策略保存失败");
  } finally {
    autoApproveInput.disabled = false;
    renderBody();
  }
});

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function replaceStatusText(element, value) {
  const beacon = element.querySelector("i");
  element.replaceChildren(beacon, document.createTextNode(value));
}

function setStatusText(value) {
  replaceStatusText(document.querySelector("#runtimeStatus"), value);
}

function formatClock(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false
  }).format(value);
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false
  }).format(value);
}

document.querySelector("#homeBtn").addEventListener("click", () => navigate("chat", "home.html"));
todoModuleBtn.addEventListener("click", () => {
  if (window.XuanModules.isEnabled("todo")) navigate("todo", "index.html");
});
document.querySelector("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
document.querySelector("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
document.querySelector("#closeBtn").addEventListener("click", () => window.desktop.close());
window.addEventListener("resize", scheduleLinkRender);
window.addEventListener("xuan:modules-changed", () => {
  renderBody();
  void refreshTelemetry();
});
window.addEventListener("xuan:permissions-changed", renderBody);
window.addEventListener("beforeunload", () => {
  clearInterval(refreshTimer);
  clearInterval(activityTimer);
  cancelAnimationFrame(linkFrame);
  topologyObserver?.disconnect();
  unsubscribeSync?.();
  moodHeartbeat?.destroy();
});

async function initializeModules() {
  await window.XuanModules.hydrate(window.desktop);
  renderBody();
  topologyObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(scheduleLinkRender)
    : null;
  topologyObserver?.observe(moduleTopology);
  await Promise.allSettled([refreshTelemetry(), refreshModuleActivity(true)]);
  refreshTimer = setInterval(refreshTelemetry, 20_000);
  activityTimer = setInterval(refreshModuleActivity, 1_100);
  if (typeof window.desktop?.onSyncChanges === "function") {
    unsubscribeSync = window.desktop.onSyncChanges(() => setTimeout(refreshTelemetry, 600));
  }
}

initializeModules().catch((error) => {
  bioshell.dataset.link = "error";
  setText("#hubStatus", "FAULT");
  setStatusText(error.message || "Hub 连接异常");
  renderBody();
});
