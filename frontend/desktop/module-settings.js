(function exposeModuleSettings(global) {
  const STORAGE_KEY = "xuan-module-settings-v1";
  const manifest = Object.freeze([
    Object.freeze({
      id: "ai",
      name: "聊天",
      description: "负责对话、理解意图并调度其他模块。",
      icon: "✦",
      color: "pink",
      core: true,
      tools: 4
    }),
    Object.freeze({
      id: "memory",
      name: "记忆中心",
      description: "管理用户画像、生活偏好、长期记忆与信息来源。",
      icon: "◈",
      color: "pink",
      core: false,
      tools: 12
    }),
    Object.freeze({
      id: "todo",
      name: "日历待办",
      description: "管理日程、待办、完成状态与跨日期安排。",
      icon: "✓",
      color: "blue",
      core: false,
      tools: 6
    }),
    Object.freeze({
      id: "image-generation",
      name: "图像生成",
      description: "调用独立的图像生成模型，把提示词生成可预览和保存的图片。",
      icon: "图",
      color: "blue",
      core: false,
      tools: 1
    }),
    Object.freeze({
      id: "time-awareness",
      name: "时间感知",
      description: "感知用户当地时区、当前时段、星期与距离上次互动的时间。",
      icon: "◷",
      color: "blue",
      core: false,
      tools: 0
    }),
    Object.freeze({
      id: "xuan-mood",
      name: "她的心情",
      description: "根据聊天、手记和共同经历生成小玄连续变化的心情、精力与关注点。",
      icon: "♡",
      color: "pink",
      core: false,
      tools: 0
    }),
    Object.freeze({
      id: "proactive-reminders",
      name: "主动提醒",
      description: "在待办开始前、到点或逾期时主动发送提醒。",
      icon: "!",
      color: "pink",
      core: false,
      tools: 0
    }),
    Object.freeze({
      id: "autonomous-journal",
      name: "自主手记",
      description: "根据原始聊天与共同经历自动写日记和周记。",
      icon: "≋",
      color: "blue",
      core: false,
      tools: 3
    }),
    Object.freeze({
      id: "anniversary-album",
      name: "我们的纪念册",
      description: "自动整理共同经历、手记和重要时刻，形成可翻阅的时间轴。",
      icon: "◇",
      color: "pink",
      core: false,
      tools: 5
    }),
    Object.freeze({
      id: "dreams",
      name: "梦境",
      description: "根据聊天、手记和记忆生成发散的虚构梦境，并明确区分梦与现实。",
      icon: "☾",
      color: "blue",
      core: false,
      tools: 3
    })
  ]);
  let remoteModules = null;

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return saved && typeof saved === "object" ? saved : {};
    } catch {
      return {};
    }
  }

  function isEnabled(id) {
    const module = manifest.find((item) => item.id === id);
    if (!module) return false;
    if (module.core) return true;
    if (remoteModules?.has(id)) return remoteModules.get(id).enabled === true;
    return readSettings()[id] !== false;
  }

  async function setEnabled(id, enabled) {
    const module = manifest.find((item) => item.id === id);
    if (!module || module.core) return false;
    if (typeof global.desktop?.updateModule === "function") {
      const remoteSnapshot = await global.desktop.updateModule(id, Boolean(enabled));
      applyRemoteSnapshot(remoteSnapshot);
    } else {
      const settings = readSettings();
      settings[id] = Boolean(enabled);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    }
    global.dispatchEvent(
      new CustomEvent("xuan:modules-changed", {
        detail: { id, enabled: isEnabled(id), snapshot: snapshot() }
      })
    );
    return true;
  }

  async function hydrate(client = global.desktop, { emit = false } = {}) {
    if (typeof client?.listModules !== "function") return snapshot();
    let modules = await client.listModules();
    const legacySettings = readLegacyModuleSettings();
    if (legacySettings && typeof client.updateModule === "function") {
      const disabledLegacyModules = modules.filter(
        (module) =>
          !module.core &&
          module.updatedAt == null &&
          Object.prototype.hasOwnProperty.call(legacySettings, module.id) &&
          legacySettings[module.id] === false
      );
      for (const module of disabledLegacyModules) {
        modules = await client.updateModule(module.id, false);
      }
    }
    applyRemoteSnapshot(modules);
    if (emit) {
      global.dispatchEvent(
        new CustomEvent("xuan:modules-changed", {
          detail: { snapshot: snapshot() }
        })
      );
    }
    return snapshot();
  }

  function readLegacyModuleSettings() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function applyRemoteSnapshot(modules) {
    if (!Array.isArray(modules)) return;
    remoteModules = new Map(
      modules
        .filter((module) => module?.id)
        .map((module) => [String(module.id), { ...module }])
    );
    const settings = readSettings();
    for (const module of modules) {
      if (!module?.id || module.core) continue;
      settings[module.id] = module.enabled === true;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }

  function isAutoApproveEnabled() {
    return readSettings().autoApproveTools !== false;
  }

  function setAutoApprove(enabled) {
    const settings = readSettings();
    settings.autoApproveTools = Boolean(enabled);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    global.dispatchEvent(
      new CustomEvent("xuan:permissions-changed", {
        detail: { autoApproveTools: Boolean(enabled) }
      })
    );
  }

  function snapshot() {
    return manifest.map((module) => {
      const remote = remoteModules?.get(module.id);
      return {
        ...module,
        ...(remote || {}),
        enabled: isEnabled(module.id),
        requestedEnabled: remote?.requestedEnabled ?? isEnabled(module.id),
        dependencies: [...(remote?.dependencies || [])],
        blockedBy: [...(remote?.blockedBy || [])]
      };
    });
  }

  global.XuanModules = Object.freeze({
    manifest,
    hydrate,
    isEnabled,
    setEnabled,
    isAutoApproveEnabled,
    setAutoApprove,
    snapshot
  });
})(window);
