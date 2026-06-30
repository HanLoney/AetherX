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
const memoryModuleBtn = document.createElement("button");
memoryModuleBtn.id = "memoryModuleBtn";
memoryModuleBtn.className = "nav-item";
memoryModuleBtn.innerHTML = "<i>🧠</i>记忆中心";
todoModuleBtn.after(memoryModuleBtn);

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
    card.querySelector(".module-meta").textContent = module.tools
      ? `${module.tools} 个 AI 工具`
      : "AI 核心能力";

    const input = card.querySelector("input");
    input.checked = module.enabled;
    input.disabled = module.core;
    input.setAttribute("aria-label", `${module.enabled ? "停用" : "启用"}${module.name}`);
    input.addEventListener("change", () => {
      window.XuanModules.setEnabled(module.id, input.checked);
      renderModules();
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
  autoApproveInput.checked = window.XuanModules.isAutoApproveEnabled();
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
document.querySelector("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
document.querySelector("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
document.querySelector("#closeBtn").addEventListener("click", () => window.desktop.close());
window.addEventListener("xuan:modules-changed", renderModules);
window.addEventListener("xuan:permissions-changed", renderModules);

renderModules();
