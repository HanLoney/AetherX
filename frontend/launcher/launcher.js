const TAILSCALE_DOWNLOAD_URL = "https://tailscale.com/download";
const state = { status: null, busy: false, qrValue: "", qrRequest: 0 };
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
}

function setText(root, selector, text) {
  const node = root.querySelector(selector);
  if (node) node.textContent = text;
}

function statusLabel(component) {
  if (!component.installed) return "未安装";
  if (component.running && component.healthy) return "运行正常";
  if (component.running) return "需要留意";
  return "已停止";
}

function renderComponent(name, component, linked) {
  const card = componentCard(name);
  const pill = card.querySelector("[data-status-pill]");
  pill.textContent = statusLabel(component);
  pill.dataset.state = component.status;
  setText(card, "[data-version]", component.version ? `v${component.version}` : "—");
  const action = card.querySelector("[data-component-action]");
  const folder = card.querySelector("[data-folder]");
  if (folder) folder.disabled = state.busy || !component.installed;
  action.disabled = state.busy;
  if (!component.installed) {
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
  } else {
    action.textContent = "启动";
    action.dataset.nextAction = `${name}-start`;
    action.dataset.mode = "start";
  }
  if (name === "hub") {
    const health = card.querySelector("[data-health]");
    health.textContent = component.healthy ? "接口响应正常" : "当前不可访问";
    health.classList.toggle("healthy", component.healthy);
    setText(card, "[data-latency]", component.latencyMs == null ? "—" : `${component.latencyMs} ms`);
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
  selectors.primaryLabel.textContent = allRunning
    ? "全部运行正常"
    : allInstalled
      ? "全部启动"
      : "一键安装并启动";
  selectors.primaryAction.dataset.action = allInstalled ? "start-all" : "deploy-all";
  selectors.primaryAction.disabled = state.busy || allRunning;
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
  selectors.activity.textContent = progress.message;
});
window.launcher.onBusy(({ busy }) => {
  state.busy = busy;
  selectors.activityDot.classList.toggle("busy", busy);
  document.querySelectorAll("button[data-action], button[data-component-action], button[data-remote-action]").forEach((button) => {
    button.disabled = busy;
  });
  if (!busy && state.status) render(state.status);
});
window.launcher.getStatus().then(render).catch((error) => showToast(error.message, true));
