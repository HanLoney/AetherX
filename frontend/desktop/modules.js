if (new URLSearchParams(window.location.search).has("embedded")) {
  document.body.classList.add("embedded");
  if (!window.desktop && window.parent?.desktop) {
    window.desktop = window.parent.desktop;
  }
}

function navigate(target, fallback) {
  if (document.body.classList.contains("embedded")) {
    window.parent.postMessage({ type: "xuan:navigate", target }, "*");
  } else {
    window.location.href = fallback;
  }
}

const moduleGrid = document.querySelector("#moduleGrid");
const template = document.querySelector("#moduleTemplate");
const todoModuleBtn = document.querySelector("#todoModuleBtn");
const autoApproveInput = document.querySelector("#autoApproveInput");
let timeAwarenessStatus = {
  state: "loading",
  text: "正在检测时间服务"
};
const memoryModuleBtn = document.createElement("button");
memoryModuleBtn.id = "memoryModuleBtn";
memoryModuleBtn.className = "nav-item";
memoryModuleBtn.innerHTML = "<i>◈</i>记忆中心";
const albumModuleBtn = document.createElement("button");
albumModuleBtn.id = "albumModuleBtn";
albumModuleBtn.className = "nav-item";
albumModuleBtn.innerHTML = "<i>◇</i>我们的纪念册";
const dreamModuleBtn = document.createElement("button");
dreamModuleBtn.id = "dreamModuleBtn";
dreamModuleBtn.className = "nav-item";
dreamModuleBtn.innerHTML = "<i>☾</i>梦境";
todoModuleBtn.after(memoryModuleBtn, albumModuleBtn, dreamModuleBtn);

function renderModules() {
  const modules = window.XuanModules.snapshot();
  moduleGrid.replaceChildren();

  modules.forEach((module) => {
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.moduleId = module.id;
    card.classList.toggle("disabled", !module.enabled);

    const icon = card.querySelector(".module-icon");
    icon.textContent = module.icon;
    icon.classList.add(module.color);
    card.querySelector(".module-title strong").textContent = module.name;
    card.querySelector(".module-title .core-badge").classList.toggle(
      "hidden",
      !module.core
    );
    card.querySelector(".module-copy p").textContent = module.description;
    card.querySelector(".module-meta").textContent =
      module.id === "time-awareness"
        ? module.enabled
          ? timeAwarenessStatus.text
          : "已关闭"
        : module.id === "proactive-reminders"
          ? !module.enabled
            ? "已关闭"
            : window.XuanModules.isEnabled("todo")
              ? "后台运行 · 提前 10 分钟提醒"
              : "需要先启用日历待办"
        : module.id === "autonomous-journal"
          ? module.enabled
            ? "后台运行 · 每日与每周写作"
            : "已关闭"
        : module.id === "xuan-mood"
          ? module.enabled
            ? "主页展示 · 生成式状态"
            : "已关闭"
        : module.id === "anniversary-album"
          ? module.enabled
            ? "时间轴展示 · AI 可书写"
            : "已关闭"
        : module.id === "dreams"
          ? module.enabled
            ? "后台运行 · 明确标记为梦"
            : "已关闭"
        : module.tools
          ? `${module.tools} 个 AI 工具`
          : "AI 核心能力";

    const input = card.querySelector("input");
    input.checked = module.enabled;
    input.disabled = module.core;
    input.setAttribute("aria-label", `${module.enabled ? "停用" : "启用"}${module.name}`);
    input.addEventListener("change", () => {
      window.XuanModules.setEnabled(module.id, input.checked);
      renderModules();
      window.parent?.postMessage(
        {
          type: "xuan:module-state-changed",
          id: module.id,
          enabled: input.checked
        },
        "*"
      );
      if (module.id === "time-awareness" && input.checked) {
        refreshTimeAwarenessStatus();
      }
    });
    moduleGrid.append(card);
  });

  const enabled = modules.filter((module) => module.enabled);
  const tools = enabled.reduce((sum, module) => sum + module.tools, 0);
  document.querySelector("#enabledCount").textContent = String(enabled.length);
  document.querySelector("#toolCount").textContent = `${tools} 个 AI 工具可用`;
  todoModuleBtn.classList.toggle(
    "hidden",
    !window.XuanModules.isEnabled("todo")
  );
  memoryModuleBtn.classList.toggle(
    "hidden",
    !window.XuanModules.isEnabled("memory")
  );
  albumModuleBtn.classList.toggle(
    "hidden",
    !window.XuanModules.isEnabled("anniversary-album")
  );
  dreamModuleBtn.classList.toggle(
    "hidden",
    !window.XuanModules.isEnabled("dreams")
  );
  autoApproveInput.checked = window.XuanModules.isAutoApproveEnabled();
}

async function refreshTimeAwarenessStatus() {
  if (!window.XuanModules.isEnabled("time-awareness")) {
    timeAwarenessStatus = { state: "disabled", text: "已关闭" };
    renderModules();
    return;
  }
  timeAwarenessStatus = { state: "loading", text: "正在检测时间服务" };
  renderModules();
  try {
    const result = await window.desktop.getTimeAwarenessContext({
      now: Date.now(),
      timeZone:
        Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
      locale: navigator.language || "zh-CN"
    });
    timeAwarenessStatus = {
      state: "ready",
      text: `运行正常 · ${result.localTime} · ${result.timeZone}`
    };
  } catch {
    timeAwarenessStatus = {
      state: "error",
      text: "连接异常 · 无法读取当前时间"
    };
  }
  renderModules();
}

autoApproveInput.addEventListener("change", () => {
  window.XuanModules.setAutoApprove(autoApproveInput.checked);
});

document.querySelector("#homeBtn").addEventListener("click", () => {
  navigate("chat", "home.html");
});
todoModuleBtn.addEventListener("click", () => {
  if (window.XuanModules.isEnabled("todo")) navigate("todo", "index.html");
});
memoryModuleBtn.addEventListener("click", () => {
  if (window.XuanModules.isEnabled("memory")) navigate("memory", "memory.html");
});
albumModuleBtn.addEventListener("click", () => {
  if (window.XuanModules.isEnabled("anniversary-album")) {
    navigate("album", "album.html");
  }
});
dreamModuleBtn.addEventListener("click", () => {
  if (window.XuanModules.isEnabled("dreams")) {
    navigate("dreams", "dream.html");
  }
});
document.querySelector("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
document.querySelector("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
document.querySelector("#closeBtn").addEventListener("click", () => window.desktop.close());
window.addEventListener("xuan:modules-changed", renderModules);
window.addEventListener("xuan:permissions-changed", renderModules);

renderModules();
refreshTimeAwarenessStatus();
