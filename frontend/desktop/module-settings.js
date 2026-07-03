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
      tools: 0
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
      tools: 2
    }),
    Object.freeze({
      id: "anniversary-album",
      name: "我们的纪念册",
      description: "自动整理共同经历、手记和重要时刻，形成可翻阅的时间轴。",
      icon: "◇",
      color: "pink",
      core: false,
      tools: 5
    })
  ]);

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
    return readSettings()[id] !== false;
  }

  function setEnabled(id, enabled) {
    const module = manifest.find((item) => item.id === id);
    if (!module || module.core) return false;
    const settings = readSettings();
    settings[id] = Boolean(enabled);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    global.dispatchEvent(
      new CustomEvent("xuan:modules-changed", {
        detail: { id, enabled: Boolean(enabled) }
      })
    );
    return true;
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
    return manifest.map((module) => ({
      ...module,
      enabled: isEnabled(module.id)
    }));
  }

  global.XuanModules = Object.freeze({
    manifest,
    isEnabled,
    setEnabled,
    isAutoApproveEnabled,
    setAutoApprove,
    snapshot
  });
})(window);
