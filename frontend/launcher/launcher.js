const state = { status: null, busy: false };
const selectors = {
  overall: document.querySelector(".health-orbit"),
  overallLabel: document.querySelector("[data-overall-label]"),
  lastCheck: document.querySelector("[data-last-check]"),
  activity: document.querySelector("[data-activity]"),
  activityDot: document.querySelector(".activity-dot"),
  primaryLabel: document.querySelector("[data-primary-label]"),
  primaryAction: document.querySelector(".primary-action"),
  stopAllAction: document.querySelector('[data-action="stop-all"]'),
  toast: document.querySelector("[data-toast]")
};
let toastTimer;

function componentCard(name) {
  return document.querySelector(`[data-component="${name}"]`);
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
  document.querySelectorAll("button[data-action], button[data-component-action]").forEach((button) => {
    button.disabled = busy;
  });
  if (!busy && state.status) render(state.status);
});
window.launcher.getStatus().then(render).catch((error) => showToast(error.message, true));
