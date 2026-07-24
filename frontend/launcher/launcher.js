const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const state = {
  status: null,
  busy: false,
  qrValue: "",
  qrRequest: 0,
  progress: { hub: null, desktop: null }
};
const selectors = {
  overall: document.querySelector(".health-orbit"),
  overallLabel: document.querySelector("[data-overall-label]"),
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
  toast: document.querySelector("[data-toast]")
};
let toastTimer;

function componentCard(name) {
  return document.querySelector(`[data-component="${name}"]`);
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
    selectors.remoteGuideTitle.textContent = "先让两台设备认识彼此";
    selectors.remoteGuide.textContent = "手机扫描这里安装 Tailscale；电脑端点击下方按钮安装。";
    selectors.remoteAction.textContent = "安装 Tailscale";
    selectors.remoteAction.dataset.nextAction = "tailscale-download";
    selectors.remoteAction.dataset.mode = "install";
  } else if (!tailscale.connected) {
    selectors.remotePill.textContent = tailscale.state === "needs-login" ? "等待登录" : "等待连接";
    selectors.remotePill.dataset.state = "stopped";
    selectors.tailscaleState.textContent = tailscale.state === "needs-login" ? "需要登录" : "当前未连接";
    selectors.remoteHealth.textContent = "等待 Tailscale";
    selectors.remoteGuideTitle.textContent = "登录同一个 Tailscale 账号";
    selectors.remoteGuide.textContent = "手机扫描二维码安装后，与这台电脑登录同一个私人网络。";
    selectors.remoteAction.textContent = "打开 Tailscale";
    selectors.remoteAction.dataset.nextAction = "tailscale-open";
    selectors.remoteAction.dataset.mode = "start";
  } else if (remote.conflict) {
    selectors.remotePill.textContent = "端口冲突";
    selectors.remotePill.dataset.state = "stopped";
    selectors.tailscaleState.textContent = "私人网络已连接";
    selectors.remoteHealth.textContent = "端口已被占用";
    selectors.remoteGuideTitle.textContent = "需要释放远程端口";
    selectors.remoteGuide.textContent = "Tailscale 的 4318 端口正由其他服务使用，AetherX 不会覆盖它。";
    selectors.remoteAction.textContent = "无法开启";
    selectors.remoteAction.dataset.nextAction = "";
    selectors.remoteAction.disabled = true;
  } else if (!remote.enabled) {
    selectors.remotePill.textContent = "可以开启";
    selectors.remotePill.dataset.state = "stopped";
    selectors.tailscaleState.textContent = "私人网络已连接";
    selectors.remoteHealth.textContent = "尚未开启";
    selectors.remoteGuideTitle.textContent = "手机端也准备好了吗？";
    selectors.remoteGuide.textContent = "扫描二维码安装并登录 Tailscale，然后开启 AetherX 远程入口。";
    selectors.remoteAction.textContent = "开启远程访问";
    selectors.remoteAction.dataset.nextAction = "remote-enable";
    selectors.remoteAction.dataset.mode = "start";
  } else {
    qrValue = remote.url;
    selectors.remotePill.textContent = remote.healthy ? "远程可用" : "等待 Hub";
    selectors.remotePill.dataset.state = remote.healthy ? "running" : "stopped";
    selectors.tailscaleState.textContent = "私人网络已连接";
    selectors.remoteHealth.textContent = remote.healthy
      ? `响应正常${remote.latencyMs == null ? "" : ` · ${remote.latencyMs} ms`}`
      : "入口已开，等待 Hub";
    selectors.remoteGuideTitle.textContent = "用手机连接 AetherX";
    selectors.remoteGuide.textContent = "在手机端登录页选择“配对电脑”并扫码，自动读取 HTTPS Hub 地址。";
    selectors.remoteAction.textContent = "关闭远程访问";
    selectors.remoteAction.dataset.nextAction = "remote-disable";
    selectors.remoteAction.dataset.mode = "stop";
  }
  void renderQr(qrValue);
  renderMobileHealth(status.mobile || {});
}

function renderMobileHealth(mobile) {
  const clients = Array.isArray(mobile.clients) ? mobile.clients : [];
  const summary = mobile.summary && typeof mobile.summary === "object"
    ? mobile.summary
    : null;
  const onlinePeers = (mobile.tailscalePeers || []).filter((peer) => peer.online);
  selectors.mobileClients.replaceChildren();
  if (clients.length) {
    selectors.mobileSummary.textContent = `${clients.filter((client) => client.status === "healthy").length} 台正常`;
  } else if (summary?.tracked) {
    selectors.mobileSummary.textContent = summary.healthy
      ? `${summary.healthy} 台正常`
      : `${summary.tracked} 台已连接`;
  } else {
    selectors.mobileSummary.textContent = mobile.available ? "等待手机心跳" : "等待 Hub";
  }

  if (!clients.length) {
    const empty = document.createElement("p");
    empty.className = "mobile-empty";
    if (summary?.tracked) {
      const abnormal = (summary.warning || 0) + (summary.idle || 0) +
        (summary.offline || 0) + (summary.incompatible || 0);
      empty.textContent = abnormal
        ? `AetherX 已收到手机心跳，其中 ${abnormal} 台需要留意。`
        : "AetherX 心跳正常，移动端连接与同步状态已收到。";
    } else if (onlinePeers.length) {
      empty.textContent = `Tailscale 已发现 ${onlinePeers.length} 台手机在线，等待 AetherX 心跳。`;
    } else {
      empty.textContent = mobile.available
        ? "Hub 已连接，手机打开 AetherX 后会在这里显示状态。"
        : "手机连接后会在这里显示实时状态。";
    }
    selectors.mobileClients.append(empty);
    return;
  }

  for (const client of clients.slice(0, 4)) {
    const item = document.createElement("article");
    item.className = `mobile-client mobile-${client.status || "offline"}`;
    const dot = document.createElement("i");
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    const detail = document.createElement("span");
    const seen = document.createElement("small");
    title.textContent = client.name || "AetherX 移动端";
    detail.textContent = mobileDetail(client);
    seen.textContent = `App v${client.appVersion || "未知"} · 游标 ${client.syncCursor || 0} · 心跳 ${relativeHeartbeat(client.ageMs)}`;
    copy.append(title, detail, seen);
    item.append(dot, copy);
    selectors.mobileClients.append(item);
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
  const healthy = status.overall === "healthy";
  selectors.overall.dataset.overall = healthy ? "healthy" : "attention";
  selectors.overallLabel.textContent = healthy ? "一切正常" : "等待就绪";
  selectors.lastCheck.textContent = "刚刚更新";
  renderComponent("hub", status.hub, status.hub.healthy);
  renderComponent("desktop", status.desktop, status.hub.healthy && status.desktop.healthy);
  renderRemote(status);
  const allInstalled = status.hub.installed && status.desktop.installed;
  const allRunning = status.hub.running && status.desktop.running;
  const desktopNeedsUpdate = Boolean(status.desktop.updateAvailable);
  selectors.primaryLabel.textContent = desktopNeedsUpdate && status.desktop.running
    ? "停止桌面端后更新"
    : desktopNeedsUpdate
      ? "更新并启动"
      : allRunning
    ? "全部运行正常"
    : allInstalled
      ? "全部启动"
      : "一键安装并启动";
  selectors.primaryAction.dataset.action = allInstalled && !desktopNeedsUpdate ? "start-all" : "deploy-all";
  selectors.primaryAction.disabled = state.busy || (desktopNeedsUpdate ? status.desktop.running : allRunning);
  selectors.stopAllAction.disabled = state.busy || !(status.hub.running || status.desktop.running);
}

function showToast(message, error = false) {
  clearTimeout(toastTimer);
  selectors.toast.textContent = message;
  selectors.toast.className = `toast show${error ? " error" : ""}`;
  toastTimer = setTimeout(() => { selectors.toast.className = "toast"; }, 3200);
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
});

window.launcher.onStatus(render);
window.launcher.onProgress((progress) => {
  if (progress.component === "hub" || progress.component === "desktop") {
    state.progress[progress.component] = progress;
    renderInstallProgress(progress.component);
  }
  selectors.activity.textContent = progress.message;
});
window.launcher.onBusy(({ busy }) => {
  state.busy = busy;
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
window.launcher.getStatus().then(render).catch((error) => showToast(error.message, true));
