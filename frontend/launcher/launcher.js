const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const state = {
  status: null,
  busy: false,
  qrValue: "",
  qrRequest: 0,
  progress: { hub: null, desktop: null },
  mobileHubJobs: Object.create(null),
  mobileHubSwitchJobs: Object.create(null)
};
const selectors = {
  overall: document.querySelector(".health-orbit"),
  controlPanel: document.querySelector(".system-control-panel"),
  overallLabel: document.querySelector("[data-overall-label]"),
  monitorState: document.querySelector("[data-monitor-state]"),
  monitorDiagnostic: document.querySelector("[data-monitor-diagnostic]"),
  monitorMobileDetail: document.querySelector("[data-monitor-mobile-detail]"),
  lastCheck: document.querySelector("[data-last-check]"),
  activity: document.querySelector("[data-activity]"),
  activityDot: document.querySelector(".activity-dot"),
  primaryLabel: document.querySelector("[data-primary-label]"),
  primaryAction: document.querySelector(".primary-action"),
  stopAllAction: document.querySelector('[data-action="stop-all"]'),
  remoteCard: document.querySelector('[data-component="remote"]'),
  remotePill: document.querySelector("[data-remote-pill]"),
  tailscaleVersion: document.querySelector("[data-tailscale-version]"),
  tailscaleState: document.querySelector("[data-tailscale-state]"),
  remoteHealth: document.querySelector("[data-remote-health]"),
  remoteUrl: document.querySelector("[data-remote-url]"),
  remoteGuideTitle: document.querySelector("[data-remote-guide-title]"),
  remoteGuide: document.querySelector("[data-remote-guide]"),
  remoteQr: document.querySelector("[data-remote-qr]"),
  remoteQrWrap: document.querySelector(".remote-qr"),
  remoteQrLoading: document.querySelector("[data-remote-qr-loading]"),
  remoteAction: document.querySelector("[data-remote-action]"),
  copyRemote: document.querySelector("[data-copy-remote]"),
  mobileSummary: document.querySelector("[data-mobile-summary]"),
  mobileClients: document.querySelector("[data-mobile-clients]"),
  mobileManager: document.querySelector("[data-mobile-hub-manager]"),
  mobileManagerList: document.querySelector("[data-mobile-hub-manager-list]"),
  toast: document.querySelector("[data-toast]")
};
let toastTimer;

function componentCard(name) {
  return document.querySelector(`[data-component="${name}"]`);
}

function monitorNode(name) {
  return document.querySelector(`[data-monitor-node="${name}"]`);
}

function setMonitorText(root, selector, text, title = "") {
  const node = root?.querySelector(selector);
  if (!node) return;
  node.textContent = text;
  node.title = title || text;
}

function setMonitorLink(name, stateName, text) {
  const link = document.querySelector(`[data-monitor-link="${name}"]`);
  if (!link) return;
  link.dataset.state = stateName;
  setMonitorText(link, `[data-monitor-${name}-link]`, text);
}

function setMapLink(name, stateName) {
  const link = document.querySelector(`[data-map-link="${name}"]`);
  if (link) link.dataset.state = stateName;
  document.querySelectorAll(`[data-map-link-state="${name}"]`).forEach((terminal) => {
    terminal.dataset.state = stateName;
  });
}

function updateMapGeometry() {
  const map = document.querySelector("[data-network-map]");
  const svg = map?.querySelector(".network-map-links");
  if (!map || !svg) return;
  const mapRect = map.getBoundingClientRect();
  if (!mapRect.width || !mapRect.height) return;
  svg.setAttribute("viewBox", `0 0 ${mapRect.width} ${mapRect.height}`);

  const point = (name) => {
    const anchor = map.querySelector(`[data-map-anchor="${name}"]`);
    if (!anchor) return null;
    const rect = anchor.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2 - mapRect.left,
      y: rect.top + rect.height / 2 - mapRect.top
    };
  };
  const links = {
    desktop: ["hub", "desktop"],
    remote: ["hub", "remote"],
    mobile: ["remote", "mobile"]
  };
  for (const [name, [fromName, toName]] of Object.entries(links)) {
    const from = point(fromName);
    const to = point(toName);
    const group = svg.querySelector(`[data-map-link="${name}"]`);
    if (!from || !to || !group) continue;
    let path;
    if (name === "mobile") {
      const bend = Math.max(36, Math.abs(to.y - from.y) * 0.46);
      path = `M${from.x} ${from.y} C${from.x} ${from.y + bend} ${to.x} ${to.y - bend} ${to.x} ${to.y}`;
    } else {
      const direction = Math.sign(to.x - from.x) || 1;
      const bend = Math.max(52, Math.abs(to.x - from.x) * 0.42);
      path = `M${from.x} ${from.y} C${from.x + direction * bend} ${from.y} ${to.x - direction * bend} ${to.y} ${to.x} ${to.y}`;
    }
    group.querySelectorAll("path").forEach((line) => line.setAttribute("d", path));
  }
}

function renderRuntimeMonitor(status) {
  const hub = status.hub || {};
  const desktop = status.desktop || {};
  const tailscale = status.tailscale || {};
  const remote = status.remote || {};
  const mobile = status.mobile || {};
  const clients = Array.isArray(mobile.clients) ? mobile.clients : [];
  const summary = mobile.summary && typeof mobile.summary === "object" ? mobile.summary : {};
  const onlinePeers = (mobile.tailscalePeers || []).filter((peer) => peer.online);
  const healthyClients = clients.filter((client) => client.status === "healthy").length || Number(summary.healthy || 0);
  const trackedClients = Math.max(clients.length, Number(summary.tracked || 0));

  const hubNode = monitorNode("hub");
  const hubState = hub.portConflict ? "danger" : hub.healthy ? "healthy" : hub.installed ? "idle" : "missing";
  hubNode.dataset.state = hubState;
  setMonitorText(hubNode, "[data-monitor-hub-state]", hub.portConflict ? "端口冲突" : hub.healthy ? "运行正常" : hub.installed ? "已停止" : "未安装");
  setMonitorText(hubNode, "[data-monitor-hub-install]", hub.installed ? `已安装 · v${hub.version || "未知"}` : "未安装");
  setMonitorText(
    hubNode,
    "[data-monitor-hub-health]",
    hub.portConflict ? "4318 被占用" : hub.healthy ? `正常${hub.latencyMs == null ? "" : ` · ${hub.latencyMs} ms`}` : "不可访问"
  );
  setMonitorText(hubNode, "[data-monitor-hub-control]", hub.controllable ? "启动器已接管" : hub.running ? "外部运行" : "未连接");
  const hubOwner = hub.portOwner?.pid
    ? `${hub.portOwner.processName || "其他程序"} · PID ${hub.portOwner.pid}`
    : hub.running
      ? `4318 · PID ${hub.pid || "未知"}`
      : "4318 · 未监听";
  setMonitorText(hubNode, "[data-monitor-hub-process]", hubOwner);

  const desktopNode = monitorNode("desktop");
  const desktopState = desktop.updateAvailable ? "update" : desktop.healthy ? "healthy" : desktop.installed ? "idle" : "missing";
  desktopNode.dataset.state = desktopState;
  setMonitorText(desktopNode, "[data-monitor-desktop-state]", desktop.updateAvailable ? "发现更新" : desktop.healthy ? "运行正常" : desktop.installed ? "已停止" : "未安装");
  const desktopVersion = desktop.updateAvailable
    ? `v${desktop.version || "?"} → v${desktop.availableVersion}`
    : desktop.installed
      ? `已安装 · v${desktop.version || "未知"}`
      : desktop.availableVersion
        ? `可安装 · v${desktop.availableVersion}`
        : "未安装";
  setMonitorText(desktopNode, "[data-monitor-desktop-install]", desktopVersion);
  setMonitorText(desktopNode, "[data-monitor-desktop-process]", desktop.running ? `运行中 · PID ${desktop.pid || "未知"}` : "当前未运行");
  setMonitorText(desktopNode, "[data-monitor-desktop-control]", desktop.controllable ? "可安全控制" : desktop.running ? "外部进程" : "未连接");
  const desktopLinked = Boolean(hub.healthy && desktop.healthy);
  setMonitorText(desktopNode, "[data-monitor-desktop-hub]", desktopLinked ? "连接正常" : hub.healthy ? "等待桌面端" : "Hub 离线");
  const desktopLinkState = desktopLinked ? "healthy" : hub.healthy || desktop.running ? "warning" : "idle";
  setMonitorLink("desktop", desktopLinkState, desktopLinked ? "IPC LINK" : hub.healthy ? "WAITING" : "OFFLINE");
  setMapLink("desktop", desktopLinkState);

  const remoteNode = monitorNode("remote");
  const remoteDanger = Boolean(remote.conflict || tailscale.error || remote.error);
  const remoteState = remoteDanger ? "danger" : remote.healthy ? "healthy" : tailscale.connected || remote.enabled ? "warning" : tailscale.installed ? "idle" : "missing";
  remoteNode.dataset.state = remoteState;
  setMonitorText(remoteNode, "[data-monitor-remote-state]", remote.conflict ? "端口冲突" : remote.healthy ? "远程可用" : remote.enabled ? "等待 Hub" : tailscale.connected ? "入口待开启" : tailscale.installed ? "未连接" : "未安装");
  const tailscaleText = !tailscale.installed
    ? "未安装"
    : tailscale.connected
      ? `已连接 · v${tailscale.version || "未知"}`
      : tailscale.state === "needs-login"
        ? "需要登录"
        : "当前未连接";
  setMonitorText(remoteNode, "[data-monitor-tailscale]", tailscaleText, tailscale.error || tailscaleText);
  const remoteHealthText = remote.conflict
    ? "HTTPS 端口冲突"
    : remote.healthy
      ? `响应正常${remote.latencyMs == null ? "" : ` · ${remote.latencyMs} ms`}`
      : remote.enabled
        ? "入口已开 · 等待 Hub"
        : "尚未开启";
  setMonitorText(remoteNode, "[data-monitor-remote-health-state]", remoteHealthText, remote.error || remoteHealthText);
  const networkText = remote.url
    ? `HTTPS${remote.latencyMs == null ? "" : ` · ${remote.latencyMs} ms`}`
    : tailscale.connected
      ? tailscale.ip || tailscale.dnsName || "私有网络在线"
      : "离线";
  setMonitorText(remoteNode, "[data-monitor-remote-network]", networkText, remote.url || tailscale.dnsName || networkText);
  const mobileText = trackedClients
    ? `${healthyClients}/${trackedClients} 健康`
    : onlinePeers.length
      ? `${onlinePeers.length} 台在线 · 等待心跳`
      : "暂无连接";
  setMonitorText(remoteNode, "[data-monitor-mobile-state]", mobileText);
  const remoteLinkState = remote.conflict ? "danger" : remote.healthy ? "healthy" : tailscale.connected ? "warning" : "idle";
  setMonitorLink("remote", remoteLinkState, remote.healthy ? "TLS LINK" : tailscale.connected ? "READY" : "OFFLINE");
  setMapLink("remote", remoteLinkState);
  const mobileLinkState = clients.some((client) => client.status === "incompatible" || client.status === "offline")
    ? "danger"
    : healthyClients
      ? "healthy"
      : trackedClients || onlinePeers.length
        ? "warning"
        : "idle";
  setMapLink("mobile", mobileLinkState);
  const mobileSector = document.querySelector("[data-mobile-monitor]");
  if (mobileSector) mobileSector.dataset.state = mobileLinkState;

  const coreHealthy = Boolean(hub.healthy && desktop.healthy);
  const allHealthy = Boolean(coreHealthy && remote.healthy);
  const hasDanger = Boolean(hub.portConflict || remoteDanger);
  const anyRunning = Boolean(hub.running || desktop.running || tailscale.connected);
  const overallState = hasDanger ? "danger" : allHealthy ? "healthy" : anyRunning ? "attention" : "idle";
  selectors.overall.dataset.overall = overallState;
  selectors.controlPanel.dataset.state = overallState;
  selectors.overallLabel.textContent = hasDanger
    ? "检测到运行异常"
    : allHealthy
      ? "链路稳定"
      : coreHealthy
        ? "核心稳定 · 远程待命"
        : anyRunning
          ? "部分节点在线"
          : "节点休眠";
  selectors.monitorState.textContent = hasDanger ? "ALERT" : allHealthy ? "ALL NOMINAL" : coreHealthy ? "CORE NOMINAL" : anyRunning ? "PARTIAL" : "STANDBY";

  let diagnostic = "各节点运行稳定";
  if (hub.portConflict) diagnostic = `Hub 端口 4318 被 ${hub.portOwner?.processName || "其他程序"}${hub.portOwner?.pid ? `（PID ${hub.portOwner.pid}）` : ""}占用`;
  else if (remote.conflict) diagnostic = "Anywhere HTTPS 端口被其他 Tailscale 服务占用";
  else if (tailscale.error || remote.error) diagnostic = tailscale.error || remote.error;
  else if (!hub.installed) diagnostic = "Hub 尚未安装，桌面端与移动端无法同步";
  else if (!hub.healthy) diagnostic = "Hub 当前不可访问，正在等待接口恢复";
  else if (!desktop.installed) diagnostic = "桌面端尚未安装";
  else if (!desktop.healthy) diagnostic = "Hub 正常，桌面端当前未运行";
  else if (desktop.updateAvailable) diagnostic = `桌面端可更新至 v${desktop.availableVersion}`;
  else if (!tailscale.installed) diagnostic = "核心链路正常；安装 Tailscale 后可启用 Anywhere";
  else if (!tailscale.connected) diagnostic = "核心链路正常；Tailscale 当前未连接";
  else if (!remote.enabled) diagnostic = "私有网络在线；Anywhere 远程入口尚未开启";
  else if (!remote.healthy) diagnostic = "Anywhere 入口已开启，正在等待 Hub 响应";
  selectors.monitorDiagnostic.textContent = diagnostic;

  const warningClients = Number(summary.warning || 0) + Number(summary.idle || 0) + Number(summary.offline || 0) + Number(summary.incompatible || 0);
  selectors.monitorMobileDetail.textContent = trackedClients
    ? `移动端：${trackedClients} 台已跟踪 · ${healthyClients} 台健康${warningClients ? ` · ${warningClients} 台需留意` : ""}`
    : onlinePeers.length
      ? `移动端：Tailscale 发现 ${onlinePeers.length} 台在线，等待 AetherX 心跳`
      : "移动端：暂无已跟踪设备";

  const latencySamples = [hub.latencyMs, remote.latencyMs].filter((value) => Number.isFinite(value));
  const slowestLatency = latencySamples.length ? Math.max(...latencySamples) : null;
  const pulseDuration = slowestLatency == null ? 2.8 : Math.max(1.65, Math.min(3.1, 1.7 + slowestLatency / 180));
  selectors.overall.style.setProperty("--pulse-duration", `${pulseDuration.toFixed(2)}s`);
}

async function renderQr(value) {
  if (!value || state.qrValue === value) return;
  state.qrValue = value;
  const request = ++state.qrRequest;
  selectors.remoteQrWrap.classList.remove("ready");
  selectors.remoteQrLoading.textContent = "正在生成";
  try {
    const dataUrl = await window.launcher.generateQr(value);
    if (request !== state.qrRequest) return;
    selectors.remoteQr.src = dataUrl;
    selectors.remoteQrWrap.classList.add("ready");
  } catch {
    if (request === state.qrRequest) selectors.remoteQrLoading.textContent = "生成失败";
  }
}

function renderRemote(status) {
  const tailscale = status.tailscale || {};
  const remote = status.remote || {};
  selectors.remoteCard.dataset.runtime = remote.conflict ? "conflict" : remote.healthy ? "running" : remote.enabled || tailscale.connected ? "stopped" : "missing";
  const remotePort = selectors.remoteCard.querySelector('[data-map-anchor="remote"]');
  if (remotePort) remotePort.dataset.state = remote.conflict ? "danger" : remote.healthy ? "healthy" : tailscale.connected ? "warning" : "idle";
  selectors.tailscaleVersion.textContent = tailscale.version ? `v${tailscale.version}` : "—";
  selectors.remoteAction.disabled = state.busy;
  selectors.copyRemote.disabled = state.busy || !remote.url;
  selectors.remoteUrl.textContent = remote.url || "—";
  selectors.remoteUrl.title = remote.url || "";
  selectors.remoteHealth.className = remote.healthy ? "healthy" : remote.enabled ? "warning" : "";

  let qrValue = TAILSCALE_DOWNLOAD_URL;
  if (!tailscale.installed) {
    selectors.remotePill.textContent = "需要安装";
    selectors.remotePill.dataset.state = "missing";
    selectors.tailscaleState.textContent = "电脑端未安装";
    selectors.remoteHealth.textContent = "尚未开启";
    selectors.remoteGuideTitle.textContent = "配置私有网络";
    selectors.remoteGuide.textContent = "手机扫描这里安装 Tailscale；电脑端点击下方按钮安装。";
    selectors.remoteAction.textContent = "安装 Tailscale";
    selectors.remoteAction.dataset.nextAction = "tailscale-download";
    selectors.remoteAction.dataset.mode = "install";
  } else if (!tailscale.connected) {
    selectors.remotePill.textContent = tailscale.state === "needs-login" ? "等待登录" : "等待连接";
    selectors.remotePill.dataset.state = "stopped";
    selectors.tailscaleState.textContent = tailscale.state === "needs-login" ? "需要登录" : "当前未连接";
    selectors.remoteHealth.textContent = "等待 Tailscale";
    selectors.remoteGuideTitle.textContent = "接入同一私有网络";
    selectors.remoteGuide.textContent = "手机扫描二维码安装后，与这台电脑登录同一个 Tailscale 账号。";
    selectors.remoteAction.textContent = "打开 Tailscale";
    selectors.remoteAction.dataset.nextAction = "tailscale-open";
    selectors.remoteAction.dataset.mode = "start";
  } else if (remote.conflict) {
    selectors.remotePill.textContent = "端口冲突";
    selectors.remotePill.dataset.state = "stopped";
    selectors.tailscaleState.textContent = "私有网络在线";
    selectors.remoteHealth.textContent = "端口已被占用";
    selectors.remoteGuideTitle.textContent = "需要释放远程端口";
    selectors.remoteGuide.textContent = "Tailscale 的 4318 端口正由其他服务使用，AetherX 不会覆盖它。";
    selectors.remoteAction.textContent = "无法开启";
    selectors.remoteAction.dataset.nextAction = "";
    selectors.remoteAction.disabled = true;
  } else if (!remote.enabled) {
    selectors.remotePill.textContent = "可以开启";
    selectors.remotePill.dataset.state = "stopped";
    selectors.tailscaleState.textContent = "私有网络在线";
    selectors.remoteHealth.textContent = "尚未开启";
    selectors.remoteGuideTitle.textContent = "建立远程连接";
    selectors.remoteGuide.textContent = "安装并登录 Tailscale 后，即可开启 AetherX 远程入口。";
    selectors.remoteAction.textContent = "开启远程访问";
    selectors.remoteAction.dataset.nextAction = "remote-enable";
    selectors.remoteAction.dataset.mode = "start";
  } else {
    qrValue = remote.url;
    selectors.remotePill.textContent = remote.healthy ? "远程可用" : "等待 Hub";
    selectors.remotePill.dataset.state = remote.healthy ? "running" : "stopped";
    selectors.tailscaleState.textContent = "私有网络在线";
    selectors.remoteHealth.textContent = remote.healthy
      ? `响应正常${remote.latencyMs == null ? "" : ` · ${remote.latencyMs} ms`}`
      : "入口已开，等待 Hub";
    selectors.remoteGuideTitle.textContent = "连接移动端";
    selectors.remoteGuide.textContent = "扫描后自动读取私有 HTTPS Hub 地址。";
    selectors.remoteAction.textContent = "关闭远程访问";
    selectors.remoteAction.dataset.nextAction = "remote-disable";
    selectors.remoteAction.dataset.mode = "stop";
  }
  void renderQr(qrValue);
  renderMobileHealth(status.mobile || {});
}

function renderMobileHealth(mobile) {
  const hubs = Array.isArray(mobile.hubs) ? mobile.hubs : [];
  const clients = Array.isArray(mobile.clients) ? mobile.clients : [];
  const summary = mobile.summary && typeof mobile.summary === "object"
    ? mobile.summary
    : null;
  const onlinePeers = (mobile.tailscalePeers || []).filter((peer) => peer.online);
  selectors.mobileClients.replaceChildren();
  if (hubs.length) {
    selectors.mobileSummary.textContent = `${hubs.filter((hub) => hub.active || hub.ready).length}/${hubs.length} Hub 就绪`;
  } else if (clients.length) {
    selectors.mobileSummary.textContent = `${clients.filter((client) => client.status === "healthy").length} 台正常`;
  } else if (summary?.tracked) {
    selectors.mobileSummary.textContent = summary.healthy
      ? `${summary.healthy} 台正常`
      : `${summary.tracked} 台已连接`;
  } else {
    selectors.mobileSummary.textContent = mobile.available ? "等待手机心跳" : "等待 Hub";
  }

  if (hubs.length) {
    for (const hub of hubs.slice(0, 4)) {
      const client = hub.client || clients.find((item) => item.localHub?.nodeId === hub.id) || null;
      appendMobileHubNode(hub, client);
    }
    if (!mobile.managementAvailable) {
      const hint = document.createElement("p");
      hint.className = "mobile-empty";
      hint.textContent = "启动桌面端并登录后可管理手机 Hub。";
      selectors.mobileClients.append(hint);
    }
    renderMobileHubManager();
    return;
  }

  if (!clients.length) {
    if (summary?.tracked) {
      const tracked = Math.min(4, Math.max(1, Number(summary.tracked || 0)));
      const healthy = Math.min(tracked, Number(summary.healthy || 0));
      for (let index = 0; index < tracked; index += 1) {
        appendMobileNode({
          name: `移动设备 ${String(index + 1).padStart(2, "0")}`,
          status: index < healthy ? "healthy" : "warning",
          detail: index < healthy ? "AetherX 已连接 · 同步正常" : "已收到心跳 · 状态需要确认",
          meta: "Hub 已收到心跳 · 设备明细同步中"
        });
      }
      return;
    }
    if (onlinePeers.length) {
      for (const peer of onlinePeers.slice(0, 4)) {
        appendMobileNode({
          name: peer.name || "Tailscale 移动设备",
          status: "warning",
          detail: "Tailscale 在线 · 等待 AetherX 心跳",
          meta: [peer.os, peer.ip].filter(Boolean).join(" · ") || "私有网络节点"
        });
      }
      return;
    }
    const empty = document.createElement("p");
    empty.className = "mobile-empty";
    empty.textContent = mobile.available
      ? "Hub 已连接，手机打开 AetherX 后会在这里显示状态。"
      : "手机连接后会在这里显示实时状态。";
    selectors.mobileClients.append(empty);
    return;
  }

  for (const client of clients.slice(0, 4)) {
    appendMobileNode({
      name: client.name || "AetherX 移动端",
      status: client.status || "offline",
      detail: mobileDetail(client),
      meta: `App v${client.appVersion || "未知"} · 游标 ${client.syncCursor || 0} · 心跳 ${relativeHeartbeat(client.ageMs)}`
    });
  }
}

function appendMobileHubNode(hub, client) {
  const status = hub.active || hub.ready ? "healthy" : hub.revokedAt ? "offline" : "warning";
  const snapshot = hub.snapshot || null;
  const recordCount = mobileHubRecordCount(hub);
  const detail = hub.active
    ? `正在承载 · ${recordCount} 条记录`
    : hub.ready
    ? `完整副本 · ${recordCount} 条记录`
    : snapshot
      ? `全量迁入 ${snapshotStatusLabel(snapshot.status)}`
      : "尚未建立完整快照";
  const heartbeat = client ? ` · App ${relativeHeartbeat(client.ageMs)}` : "";
  const item = appendMobileNode({
    name: hub.name || "Android Local Hub",
    status,
    detail,
    meta: `${hub.active ? "当前 Hub" : "备用 Hub"} · ${nodeStatusLabel(hub.status)}${heartbeat}`
  });
  const actions = document.createElement("div");
  actions.className = "mobile-client-actions";
  const progress = mobileHubProgress(hub);
  if (!progress?.switching) {
    const sync = document.createElement("button");
    sync.type = "button";
    sync.dataset.mobileSync = hub.id;
    sync.textContent = progress?.active
      ? `${progress.label} ${progress.percent}%`
      : hub.active || hub.ready
        ? hub.active ? "同步到电脑" : "同步到手机"
        : "继续迁入";
    sync.disabled = !state.status?.mobile?.managementAvailable || Boolean(progress?.active);
    actions.append(sync);
  }
  if (hub.active || hub.ready) {
    const switchHub = document.createElement("button");
    switchHub.type = "button";
    switchHub.dataset.mobileSwitch = hub.id;
    switchHub.textContent = progress?.switching
      ? `${progress.label} ${progress.percent}%`
      : hub.active ? "切回电脑 Hub" : "切换为当前 Hub";
    switchHub.disabled = !state.status?.mobile?.managementAvailable || Boolean(progress?.active);
    actions.append(switchHub);
  }
  const manage = document.createElement("button");
  manage.type = "button";
  manage.dataset.mobileManage = hub.id;
  manage.textContent = "管理";
  actions.append(manage);
  appendMobileHubProgress(item, progress);
  item.append(actions);
}

function mobileHubRecordCount(hub) {
  const liveCount = Number(hub?.progress?.documentCount);
  if (Number.isSafeInteger(liveCount) && liveCount >= 0) return liveCount;
  return Math.max(0, Number(hub?.snapshot?.recordCount || 0));
}

function appendMobileNode({ name, status, detail, meta }) {
  const item = document.createElement("article");
  item.className = `mobile-client mobile-${status || "offline"}`;
  const dot = document.createElement("i");
  const copy = document.createElement("div");
  const title = document.createElement("strong");
  const description = document.createElement("span");
  const seen = document.createElement("small");
  title.textContent = name;
  description.textContent = detail;
  seen.textContent = meta;
  copy.append(title, description, seen);
  item.append(dot, copy);
  selectors.mobileClients.append(item);
  return item;
}

function snapshotStatusLabel(status) {
  return ({ completed: "已完成", payload_ready: "等待手机接收", waiting_blobs: "正在同步原图", restored: "等待最终确认" })[status] || "未完成";
}

function nodeStatusLabel(status) {
  return ({ active: "正在承载", standby: "待命", standby_pending: "等待确认", pairing: "配对中" })[status] || "需要检查";
}

function mobileHubProgress(hub) {
  const switchJob = state.mobileHubSwitchJobs[hub.id] || null;
  const reported = hub.progress || null;
  if (switchJob) {
    const completed = switchJob.target === "mobile" ? hub.active : !hub.active;
    if (completed) {
      delete state.mobileHubSwitchJobs[hub.id];
      return {
        stage: "switch_completed",
        percent: 100,
        label: switchJob.target === "mobile" ? "手机 Hub 已接管" : "电脑 Hub 已接管",
        detail: "活动节点已经安全切换，数据副本与代次保持一致",
        active: false,
        switching: true,
        error: false
      };
    }
    const freshReport = reported && Number(reported.updatedAt || 0) >= Number(switchJob.requestedAt || 0);
    if (freshReport && String(reported.stage || "").startsWith("switch_")) {
      const stage = String(reported.stage || "");
      const error = stage === "switch_error";
      if (error) delete state.mobileHubSwitchJobs[hub.id];
      return {
        stage,
        percent: Math.max(0, Math.min(100, Number(reported.progress || 0))),
        label: mobileHubStageLabel(stage),
        detail: error ? (hub.client?.lastError || reported.status || "Hub 切换失败") : mobileHubStageDetail(reported),
        active: !error,
        switching: true,
        error
      };
    }
    if (switchJob.status === "error") {
      delete state.mobileHubSwitchJobs[hub.id];
      return { stage: "switch_error", percent: 0, label: "切换失败", detail: switchJob.message, active: false, switching: true, error: true };
    }
    return {
      stage: "switch_waiting",
      percent: 8,
      label: "等待手机确认",
      detail: switchJob.target === "mobile" ? "手机正在追平最新变更并执行完整性门禁" : "手机正在把活动节点安全交还给电脑 Hub",
      active: true,
      switching: true,
      error: false
    };
  }
  const reportedSwitchStage = String(reported?.stage || "");
  if (reportedSwitchStage.startsWith("switch_")) {
    const error = reportedSwitchStage === "switch_error";
    const completed = reportedSwitchStage === "switch_completed";
    return {
      stage: reportedSwitchStage,
      percent: Math.max(0, Math.min(100, Number(reported?.progress || 0))),
      label: mobileHubStageLabel(reportedSwitchStage),
      detail: error ? (hub.client?.lastError || "Hub 切换失败") : mobileHubStageDetail(reported),
      active: !error && !completed,
      switching: true,
      error
    };
  }
  const job = state.mobileHubJobs[hub.id] || null;
  const syncProof = hub.replication || null;
  if (
    job &&
    syncProof?.caughtUp === true &&
    Number(syncProof.lastSuccessAt || 0) >= Number(job.requestedAt || 0)
  ) {
    delete state.mobileHubJobs[hub.id];
    return {
      stage: "completed",
      percent: 100,
      label: "同步完成",
      detail: job.direction === "desktop"
        ? "电脑 Hub 已追平手机端最新变更"
        : "手机 Hub 已追平电脑端最新变更",
      active: false,
      error: false
    };
  }
  const freshReport = reported && (!job || Number(reported.updatedAt || 0) >= Number(job.requestedAt || 0));
  if (freshReport) {
    const stage = String(reported.stage || "");
    const error = stage === "error";
    const completed = stage === "completed";
    const active = ["starting", "syncing_structure", "syncing_media", "verifying", "syncing_changes"].includes(stage);
    const syncingToDesktop = job?.direction === "desktop" || (
      hub.active && ["starting", "syncing_changes", "completed", "error"].includes(stage)
    );
    if ((error || completed) && job) delete state.mobileHubJobs[hub.id];
    return {
      stage,
      percent: Math.max(0, Math.min(100, Number(reported.progress || 0))),
      label: syncingToDesktop ? mobileHubPushStageLabel(stage) : mobileHubStageLabel(stage),
      detail: error
        ? (hub.client?.lastError || (syncingToDesktop ? "同步到电脑 Hub 失败" : "同步到手机 Hub 失败"))
        : syncingToDesktop ? mobileHubPushStageDetail(stage) : mobileHubStageDetail(reported),
      active,
      error
    };
  }
  if (!job) return null;
  if (job.status === "error") {
    return {
      stage: "error",
      percent: 0,
      label: job.direction === "desktop" ? "同步失败" : "迁入失败",
      detail: job.message,
      active: false,
      error: true
    };
  }
  return {
    stage: job.queued ? "queued" : "waiting_phone",
    percent: job.queued ? 4 : 8,
    label: job.queued ? "等待手机上线" : "等待手机响应",
    detail: job.queued
      ? "指令已排队，手机恢复实时连接后继续"
      : `指令已送达，正在等待同步到${job.direction === "desktop" ? "电脑 Hub" : "手机 Hub"}`,
    active: true,
    error: false
  };
}

function mobileHubPushStageLabel(stage) {
  return ({
    starting: "准备双端同步",
    syncing_changes: "推送最新变更",
    completed: "同步完成",
    error: "同步失败"
  })[stage] || "同步到电脑 Hub";
}

function mobileHubPushStageDetail(stage) {
  return ({
    starting: "手机正在读取本机操作链并连接电脑 Hub",
    syncing_changes: "正在把手机端产生的最新记录推送到电脑副本",
    completed: "电脑 Hub 已追平手机端最新变更"
  })[stage] || "正在同步到电脑 Hub";
}

function mobileHubStageLabel(stage) {
  return ({
    starting: "准备迁入",
    syncing_structure: "迁入结构数据",
    ready_to_resume: "等待继续迁入",
    syncing_media: "迁入原图",
    paused_media: "原图待续传",
    verifying: "完整性校验",
    ready_to_verify: "等待最终校验",
    syncing_changes: "追平变更",
    switch_preparing: "准备切换",
    switch_syncing: "追平最新变更",
    switch_verifying: "切换完整性校验",
    switch_committing: "提交活动节点",
    switch_returning: "交还电脑 Hub",
    switch_completed: "切换完成",
    switch_error: "切换失败",
    completed: "迁入完成",
    error: "迁入失败"
  })[stage] || "检查迁入";
}

function mobileHubStageDetail(progress) {
  if (["syncing_media", "paused_media"].includes(progress.stage)) {
    const total = Number(progress.mediaTotalBytes || 0);
    const received = Number(progress.mediaBytes || 0);
    const bytes = total > 0 ? ` · ${formatBytes(received)} / ${formatBytes(total)}` : "";
    return `正在同步原图${bytes}${progress.pendingMediaCount ? ` · 剩余 ${progress.pendingMediaCount} 项` : ""}`;
  }
  return ({
    starting: "手机已收到指令，正在读取本机副本",
    syncing_structure: "正在从电脑 Hub 重新拉取完整结构化数据",
    ready_to_resume: "结构化数据尚未落入手机，点击继续迁入即可恢复",
    verifying: "正在核对记录根、媒体根与完成证明",
    ready_to_verify: "原图已经到齐，点击继续迁入完成最终校验",
    syncing_changes: "正在拉取配对后产生的最新记录",
    switch_preparing: "正在读取双 Hub 状态并锁定本次切换目标",
    switch_syncing: "正在把电脑端最新操作追平到手机副本",
    switch_verifying: "正在核对操作链、记录根、原图根与数据库版本",
    switch_committing: "完整性门禁已通过，正在提交新的活动节点",
    switch_returning: "正在把活动节点安全交还给电脑 Hub",
    switch_completed: "活动节点已经安全切换",
    completed: `副本完整 · ${progress.documentCount || 0} 条记录`
  })[progress.stage] || "正在读取手机 Hub 状态";
}

function appendMobileHubProgress(container, progress) {
  if (!progress) return;
  const block = document.createElement("div");
  block.className = `mobile-hub-progress${progress.error ? " error" : ""}`;
  const copy = document.createElement("div");
  const label = document.createElement("strong");
  const value = document.createElement("span");
  const detail = document.createElement("small");
  const track = document.createElement("i");
  const bar = document.createElement("b");
  label.textContent = progress.label;
  value.textContent = `${progress.percent}%`;
  detail.textContent = progress.detail;
  detail.title = progress.detail;
  bar.style.width = `${progress.percent}%`;
  copy.append(label, value);
  track.append(bar);
  block.append(copy, track, detail);
  container.append(block);
}

function formatBytes(value) {
  const bytes = Math.max(0, Number(value || 0));
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function renderMobileHubManager(focusNodeId = "") {
  if (!selectors.mobileManagerList) return;
  const hubs = state.status?.mobile?.hubs || [];
  selectors.mobileManagerList.replaceChildren();
  if (!hubs.length) {
    const empty = document.createElement("p");
    empty.className = "mobile-hub-manager-empty";
    empty.textContent = state.status?.mobile?.managementAvailable
      ? "还没有完成配对的手机 Hub。请先在桌面端生成备用 Hub 配对码。"
      : "启动桌面端并登录 AetherX 后，这里会显示手机 Hub。";
    selectors.mobileManagerList.append(empty);
    return;
  }
  for (const hub of hubs) {
    const card = document.createElement("article");
    card.className = `mobile-hub-manager-card ${hub.active ? "active" : hub.ready ? "ready" : hub.revokedAt ? "offline" : "pending"}`;
    card.dataset.nodeId = hub.id;
    const snapshot = hub.snapshot || null;
    card.innerHTML = `
      <header><h3></h3><span></span></header>
      <dl>
        <div><dt>节点角色</dt><dd data-field="role"></dd></div>
        <div><dt>快照状态</dt><dd data-field="snapshot"></dd></div>
        <div><dt>记录数量</dt><dd data-field="records"></dd></div>
        <div><dt>最近响应</dt><dd data-field="seen"></dd></div>
      </dl>
      <div data-mobile-progress></div>
      <div class="manager-actions"><button type="button" data-mobile-sync></button><button type="button" data-mobile-switch></button><button type="button" data-mobile-open-desktop>配对设置</button></div>`;
    setText(card, "h3", hub.name || "Android Local Hub");
    setText(card, "header span", hub.active ? "当前承载" : hub.ready ? "副本完整" : "需要恢复");
    setText(card, '[data-field="role"]', hub.active ? "当前 Hub" : "备用 Hub");
    setText(card, '[data-field="snapshot"]', snapshot ? snapshotStatusLabel(snapshot.status) : "尚未创建");
    setText(card, '[data-field="records"]', `${mobileHubRecordCount(hub)} 条`);
    setText(card, '[data-field="seen"]', hub.lastSeenAt ? relativeHeartbeat(Date.now() - hub.lastSeenAt) : "未收到");
    const progress = mobileHubProgress(hub);
    appendMobileHubProgress(card.querySelector("[data-mobile-progress]"), progress);
    const sync = card.querySelector("[data-mobile-sync]");
    sync.dataset.mobileSync = hub.id;
    sync.textContent = progress?.active
      ? `${progress.label} ${progress.percent}%`
      : hub.active || hub.ready
        ? hub.active ? "同步到电脑 Hub" : "同步到手机 Hub"
        : "继续迁入";
    sync.disabled = !state.status?.mobile?.managementAvailable || Boolean(progress?.active);
    sync.hidden = Boolean(progress?.switching);
    const switchHub = card.querySelector("[data-mobile-switch]");
    switchHub.dataset.mobileSwitch = hub.id;
    switchHub.textContent = progress?.switching
      ? `${progress.label} ${progress.percent}%`
      : hub.active ? "切回电脑 Hub" : "切换为当前 Hub";
    switchHub.disabled = (!hub.active && !hub.ready) || !state.status?.mobile?.managementAvailable || Boolean(progress?.active);
    selectors.mobileManagerList.append(card);
  }
  if (focusNodeId) {
    requestAnimationFrame(() => selectors.mobileManagerList.querySelector(`[data-node-id="${CSS.escape(focusNodeId)}"]`)?.scrollIntoView({ block: "center" }));
  }
}

function openMobileHubManager(nodeId = "") {
  renderMobileHubManager(nodeId);
  selectors.mobileManager.hidden = false;
}

function closeMobileHubManager() {
  selectors.mobileManager.hidden = true;
}

async function synchronizeMobileHub(nodeId, button) {
  if (!nodeId || button?.disabled) return;
  const hub = state.status?.mobile?.hubs?.find((item) => item.id === nodeId);
  const direction = hub?.active ? "desktop" : "mobile";
  state.mobileHubJobs[nodeId] = { status: "requesting", requestedAt: Date.now(), queued: false, direction };
  if (state.status) renderMobileHealth(state.status.mobile || {});
  try {
    const result = await window.launcher.synchronizeMobileHub(nodeId);
    state.mobileHubJobs[nodeId] = {
      status: "waiting",
      requestedAt: Number(result.requestedAt || Date.now()),
      queued: Boolean(result.queued),
      direction
    };
    if (state.status) renderMobileHealth(state.status.mobile || {});
    const destination = direction === "desktop" ? "电脑 Hub" : "手机 Hub";
    showToast(result.queued
      ? `手机暂时离线，同步到${destination}的任务已排队`
      : `手机已收到指令，正在同步到${destination}`);
  } catch (error) {
    state.mobileHubJobs[nodeId] = {
      status: "error",
      requestedAt: Date.now(),
      queued: false,
      message: error.message || "没有成功下发迁入任务"
    };
    if (state.status) renderMobileHealth(state.status.mobile || {});
    showToast(error.message || "没有成功下发同步指令", true);
  }
}

async function switchMobileHub(nodeId, button) {
  if (!nodeId || button?.disabled) return;
  const hub = state.status?.mobile?.hubs?.find((item) => item.id === nodeId);
  const target = hub?.active ? "desktop" : "mobile";
  state.mobileHubSwitchJobs[nodeId] = { status: "requesting", target, requestedAt: Date.now() };
  if (state.status) renderMobileHealth(state.status.mobile || {});
  try {
    const result = await window.launcher.switchMobileHub(nodeId);
    state.mobileHubSwitchJobs[nodeId] = {
      status: "waiting",
      target: result.target || target,
      requestedAt: Number(result.requestedAt || Date.now())
    };
    if (state.status) renderMobileHealth(state.status.mobile || {});
    showToast(result.target === "desktop" ? "手机正在把活动节点交还给电脑 Hub" : "手机已收到切换指令，正在追平并校验");
  } catch (error) {
    state.mobileHubSwitchJobs[nodeId] = {
      status: "error",
      target,
      requestedAt: Date.now(),
      message: error.message || "没有成功下发切换指令"
    };
    if (state.status) renderMobileHealth(state.status.mobile || {});
    showToast(error.message || "没有成功下发切换指令", true);
  }
}

function mobileDetail(client) {
  if (client.status === "incompatible") return `App v${client.appVersion || "未知"} · 版本不兼容`;
  if (client.status === "healthy") {
    return `AetherX 已连接 · 同步正常${client.latencyMs == null ? "" : ` · ${client.latencyMs} ms`}`;
  }
  if (client.status === "warning") {
    return client.sseConnected ? "心跳正常 · 同步需要检查" : "心跳正常 · 实时通道重连中";
  }
  if (client.status === "idle") return client.foreground ? "连接暂时休眠" : "应用位于后台";
  return "当前连接中断";
}

function relativeHeartbeat(ageMs) {
  const seconds = Math.max(0, Math.round(Number(ageMs || 0) / 1000));
  if (seconds < 10) return "刚刚";
  if (seconds < 60) return `${seconds} 秒前`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;
  return `${Math.round(minutes / 60)} 小时前`;
}

function setText(root, selector, text) {
  const node = root.querySelector(selector);
  if (node) node.textContent = text;
}

function statusLabel(component) {
  if (component.portConflict) return "端口冲突";
  if (!component.installed) return "未安装";
  if (component.updateAvailable) return component.running ? "运行中 · 有更新" : "有更新";
  if (component.running && component.healthy) return "运行正常";
  if (component.running) return "需要留意";
  return "已停止";
}

function renderInstallProgress(name) {
  const card = componentCard(name);
  const progress = state.progress[name];
  const wrap = card.querySelector("[data-install-progress]");
  const action = card.querySelector("[data-component-action]");
  if (!wrap) return;
  if (!progress) {
    wrap.hidden = true;
    card.classList.remove("installing", "install-failed");
    return;
  }
  const failed = progress.phase === "failed";
  const percent = failed ? 100 : Math.max(0, Math.min(100, Number(progress.percent || 0)));
  wrap.hidden = false;
  card.classList.toggle("installing", !failed && progress.phase !== "installed");
  card.classList.toggle("install-failed", failed);
  setText(wrap, "[data-progress-label]", progress.message || "正在安装");
  setText(wrap, "[data-progress-value]", failed ? "失败" : `${Math.round(percent)}%`);
  const track = wrap.querySelector(".install-progress-track");
  const bar = wrap.querySelector("[data-progress-bar]");
  track.setAttribute("aria-valuenow", String(Math.round(percent)));
  bar.style.width = `${percent}%`;
  if (!failed && progress.phase !== "installed") {
    action.textContent = `${name === "hub" ? "安装 Hub" : "安装桌面端"} · ${Math.round(percent)}%`;
    action.disabled = true;
  }
}

function renderComponent(name, component, linked) {
  const card = componentCard(name);
  card.dataset.runtime = component.portConflict ? "conflict" : component.status;
  const mapPort = card.querySelector(`[data-map-anchor="${name}"]`);
  if (mapPort) mapPort.dataset.state = component.portConflict ? "danger" : component.healthy ? "healthy" : component.running ? "warning" : "idle";
  const pill = card.querySelector("[data-status-pill]");
  pill.textContent = statusLabel(component);
  pill.dataset.state = component.portConflict
    ? "conflict"
    : component.updateAvailable
      ? "update"
      : component.status;
  const versionText = component.updateAvailable
    ? `v${component.version || "?"} → v${component.availableVersion}`
    : component.version
      ? `v${component.version}`
      : component.availableVersion
        ? `v${component.availableVersion}`
        : "—";
  setText(card, "[data-version]", versionText);
  const action = card.querySelector("[data-component-action]");
  const folder = card.querySelector("[data-folder]");
  if (folder) folder.disabled = state.busy || !component.installed;
  action.disabled = state.busy;
  if (name === "hub" && component.portConflict) {
    action.textContent = "端口被占用";
    action.dataset.nextAction = "";
    action.dataset.mode = "stop";
    action.disabled = true;
  } else if (!component.installed) {
    action.textContent = name === "hub" ? "安装 Hub" : "安装桌面端";
    action.dataset.nextAction = `${name}-install`;
    action.dataset.mode = "install";
  } else if (component.running && component.controllable) {
    action.textContent = "停止";
    action.dataset.nextAction = `${name}-stop`;
    action.dataset.mode = "stop";
  } else if (component.running) {
    action.textContent = "正在外部运行";
    action.dataset.nextAction = "";
    action.disabled = true;
  } else if (name === "desktop" && component.updateAvailable) {
    action.textContent = "更新桌面端";
    action.dataset.nextAction = "desktop-install";
    action.dataset.mode = "install";
  } else {
    action.textContent = "启动";
    action.dataset.nextAction = `${name}-start`;
    action.dataset.mode = "start";
  }
  renderInstallProgress(name);
  if (name === "hub") {
    const health = card.querySelector("[data-health]");
    const owner = component.portOwner?.pid
      ? `${component.portOwner.processName || "其他程序"} · PID ${component.portOwner.pid}`
      : "其他程序";
    health.textContent = component.portConflict
      ? `4318 被 ${owner} 占用`
      : component.healthy
        ? "接口响应正常"
        : "当前不可访问";
    health.title = component.portConflict ? health.textContent : "";
    health.classList.toggle("healthy", component.healthy);
    setText(
      card,
      "[data-latency]",
      component.portConflict ? "端口冲突" : component.latencyMs == null ? "—" : `${component.latencyMs} ms`
    );
  } else {
    const health = card.querySelector("[data-health]");
    health.textContent = component.healthy ? "进程响应正常" : "当前未运行";
    health.classList.toggle("healthy", component.healthy);
    setText(card, "[data-control]", component.controllable ? "可以安全控制" : "未连接");
    setText(card, "[data-link]", linked ? "连接正常" : "等待 Hub");
  }
}

function render(status) {
  if (!status) return;
  state.status = status;
  renderRuntimeMonitor(status);
  selectors.lastCheck.textContent = "刚刚更新";
  renderComponent("hub", status.hub, status.hub.healthy);
  renderComponent("desktop", status.desktop, status.hub.healthy && status.desktop.healthy);
  renderRemote(status);
  if (selectors.mobileManager && !selectors.mobileManager.hidden) renderMobileHubManager();
  const allInstalled = status.hub.installed && status.desktop.installed;
  const allRunning = status.hub.running && status.desktop.running;
  const desktopNeedsUpdate = Boolean(status.desktop.updateAvailable);
  selectors.primaryLabel.textContent = desktopNeedsUpdate && status.desktop.running
    ? "停止桌面端后更新"
    : desktopNeedsUpdate
      ? "更新并启动"
      : allRunning
    ? "系统稳定"
    : allInstalled
      ? "全部启动"
      : "一键安装并启动";
  selectors.primaryAction.dataset.action = allInstalled && !desktopNeedsUpdate ? "start-all" : "deploy-all";
  selectors.primaryAction.disabled = state.busy || (desktopNeedsUpdate ? status.desktop.running : allRunning);
  selectors.stopAllAction.disabled = state.busy || !(status.hub.running || status.desktop.running);
  requestAnimationFrame(updateMapGeometry);
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  selectors.toast.textContent = message;
  selectors.toast.className = `toast show${error ? " error" : ""}`;
  toastTimer = setTimeout(
    () => { selectors.toast.className = "toast"; },
    error ? 7200 : 4200
  );
}

async function run(action) {
  if (!action || state.busy) return;
  try {
    const status = await window.launcher.runAction(action);
    render(status);
    showToast("操作已完成");
  } catch (error) {
    showToast(error.message || "操作失败", true);
    selectors.activity.textContent = error.message || "操作失败";
  }
}

document.querySelectorAll("[data-window]").forEach((button) => {
  button.addEventListener("click", () => window.launcher[button.dataset.window]());
});
document.addEventListener("click", (event) => {
  const globalAction = event.target.closest("[data-action]");
  if (globalAction) run(globalAction.dataset.action);
  const componentAction = event.target.closest("[data-component-action]");
  if (componentAction) run(componentAction.dataset.nextAction);
  const remoteAction = event.target.closest("[data-remote-action]");
  if (remoteAction) run(remoteAction.dataset.nextAction);
  const copyRemote = event.target.closest("[data-copy-remote]");
  if (copyRemote && state.status?.remote?.url) {
    window.launcher.copyText(state.status.remote.url).then(() => showToast("远程地址已复制"));
  }
  const folder = event.target.closest("[data-folder]");
  if (folder) window.launcher.openFolder(folder.dataset.folder);
  const mobileManage = event.target.closest("[data-mobile-manage]");
  if (mobileManage) openMobileHubManager(mobileManage.dataset.mobileManage);
  if (event.target.closest("[data-mobile-manage-all]")) openMobileHubManager();
  const mobileSync = event.target.closest("[data-mobile-sync]");
  if (mobileSync) void synchronizeMobileHub(mobileSync.dataset.mobileSync, mobileSync);
  const mobileSwitch = event.target.closest("[data-mobile-switch]");
  if (mobileSwitch) void switchMobileHub(mobileSwitch.dataset.mobileSwitch, mobileSwitch);
  if (event.target.closest("[data-mobile-manager-close]") || event.target === selectors.mobileManager) closeMobileHubManager();
  if (event.target.closest("[data-mobile-open-desktop]")) {
    window.launcher.focusDesktop().then(() => showToast("已打开桌面端，可继续配对或管理设备")).catch((error) => showToast(error.message, true));
  }
});

window.launcher.onStatus(render);
window.launcher.onProgress((progress) => {
  if (progress.component === "hub" || progress.component === "desktop") {
    state.progress[progress.component] = progress;
    renderInstallProgress(progress.component);
    requestAnimationFrame(updateMapGeometry);
  }
  selectors.activity.textContent = progress.message;
});
window.launcher.onBusy(({ busy }) => {
  state.busy = busy;
  document.body.classList.toggle("is-busy", busy);
  selectors.activityDot.classList.toggle("busy", busy);
  document.querySelectorAll("button[data-action], button[data-component-action], button[data-remote-action]").forEach((button) => {
    button.disabled = busy;
  });
  if (!busy) {
    for (const component of ["hub", "desktop"]) {
      const progress = state.progress[component];
      if (progress && progress.phase !== "failed") {
        setTimeout(() => {
          if (state.progress[component] === progress) {
            state.progress[component] = null;
            if (state.status) render(state.status);
          }
        }, 900);
      }
    }
    if (state.status) render(state.status);
  }
});
const networkMap = document.querySelector("[data-network-map]");
if (networkMap && typeof ResizeObserver === "function") {
  const mapResizeObserver = new ResizeObserver(updateMapGeometry);
  mapResizeObserver.observe(networkMap);
  networkMap.querySelectorAll(".map-node, .map-mobile-sector").forEach((node) => mapResizeObserver.observe(node));
}
requestAnimationFrame(updateMapGeometry);
window.launcher.getStatus().then(render).catch((error) => showToast(error.message, true));
