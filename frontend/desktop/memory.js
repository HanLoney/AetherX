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

const state = {
  profile: null,
  assistantProfile: null,
  personalityEvents: [],
  sharedMemories: [],
  promptBundle: null,
  promptVersions: [],
  preferences: [],
  memories: [],
  settings: { autoConfirm: false, autoConfirmAll: false }
};
const $ = (selector) => document.querySelector(selector);
const DOMAIN_LABELS = {
  profile: "用户画像",
  life: "生活",
  relationship: "人际关系",
  health: "健康",
  work: "工作",
  learning: "学习",
  emotion: "情绪关怀"
};
const TYPE_LABELS = {
  fact: "事实",
  episode: "经历",
  decision: "决定",
  plan: "计划",
  routine: "习惯"
};
const DOMAIN_ICONS = {
  profile: [
    "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
    "M4 21a8 8 0 0 1 16 0"
  ],
  life: ["m3 11 9-8 9 8", "M5 10v11h14V10", "M9 21v-6h6v6"],
  relationship: [
    "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z"
  ],
  health: ["M3 12h4l3-8 4 16 3-8h4"],
  work: [
    "M4 7h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z",
    "M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2",
    "M2 12h20"
  ],
  learning: [
    "M3 5a7 7 0 0 1 9 2v14a7 7 0 0 0-9-2V5Z",
    "M21 5a7 7 0 0 0-9 2v14a7 7 0 0 1 9-2V5Z"
  ],
  emotion: [
    "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z",
    "M8 14s1.5 2 4 2 4-2 4-2",
    "M9 9h.01",
    "M15 9h.01"
  ],
  shared: [
    "M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1",
    "M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"
  ]
};
const STATUS_GROUPS = [
  { status: "candidate", label: "待确认记忆", description: ({ userName }) => `需要${userName}确认后才会参与召回` },
  { status: "active", label: "已确认记忆", description: ({ assistantName }) => `${assistantName}会在相关场景中自然想起` },
  { status: "archived", label: "已归档记忆", description: "保留记录，但不会参与召回" }
];

function participantNames() {
  return {
    userName:
      state.profile?.preferredName || state.profile?.displayName || "你",
    assistantName: state.assistantProfile?.name || "小玄"
  };
}

function groupDescription(groupInfo) {
  return typeof groupInfo.description === "function"
    ? groupInfo.description(participantNames())
    : groupInfo.description;
}

function showNotice(message, error = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice${error ? " error" : ""}`;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => notice.classList.add("hidden"), 3200);
}

function formatDate(value) {
  return value
    ? new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(value)
    : "长期有效";
}

async function loadAll() {
  await window.desktop.consolidateMemories();
  const [
    profile,
    assistantProfile,
    personalityEvents,
    sharedMemories,
    promptBundle,
    promptVersions,
    preferences,
    memories,
    settings
  ] = await Promise.all([
    window.desktop.getProfile(),
    window.desktop.getAssistantProfile(),
    window.desktop.listPersonalityEvents(),
    window.desktop.listSharedMemories(),
    window.desktop.getPromptSettings(),
    window.desktop.listPromptVersions(),
    window.desktop.listPreferences(),
    window.desktop.listMemories(),
    window.desktop.getMemorySettings()
  ]);
  state.profile = profile;
  state.assistantProfile = assistantProfile;
  state.personalityEvents = personalityEvents;
  state.sharedMemories = sharedMemories;
  state.promptBundle = promptBundle;
  state.promptVersions = promptVersions;
  state.preferences = preferences;
  state.memories = memories;
  state.settings = settings;
  renderProfile();
  renderAssistantProfile();
  renderPersonalityEvents();
  renderSharedMemories();
  renderPromptSettings();
  renderPreferences();
  renderMemories();
  renderMemorySettings();
}

function renderMemorySettings() {
  const autoConfirm = Boolean(state.settings.autoConfirm);
  const autoConfirmAll = Boolean(state.settings.autoConfirmAll);
  $("#autoConfirmMemory").checked = autoConfirm;
  $("#autoConfirmAllMemory").checked = autoConfirmAll;
  $("#autoConfirmAllMemory").disabled = !autoConfirm;
  $("#autoConfirmStatus").textContent = autoConfirm
    ? "已开启"
    : "已关闭";
  $("#autoConfirmAllStatus").textContent = autoConfirmAll
    ? "已开启"
    : "已关闭";
}

function switchView(view) {
  document.querySelectorAll(".memory-tab").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === view);
  });
  document.querySelectorAll(".tab-view").forEach((panel) => {
    panel.classList.toggle("hidden", panel.id !== `${view}View`);
  });
}

function renderProfile() {
  const profile = state.profile;
  $("#displayName").value = profile.displayName || "";
  $("#preferredName").value = profile.preferredName || "";
  $("#birthday").value = profile.birthday || "";
  $("#occupation").value = profile.occupation || "";
  $("#bio").value = profile.bio || "";
  $("#goals").value = (profile.goals || []).join("\n");
}

function renderAssistantProfile() {
  const profile = state.assistantProfile;
  $("#assistantName").value = profile.name || "";
  $("#assistantGender").value = profile.gender || "";
  $("#assistantDefinition").value = profile.selfDefinition || "";
  $("#assistantRelationship").value = profile.relationshipSummary || "";
  $("#assistantValues").value = (profile.values || [])
    .map((item) => `${item.key}：${item.value}`)
    .join("\n");

  const list = $("#assistantTraitList");
  list.replaceChildren();
  (profile.traits || []).forEach((trait) => {
    const card = document.createElement("article");
    card.className = "trait-card";
    const title = document.createElement("strong");
    title.textContent = trait.key;
    const value = document.createElement("p");
    value.textContent = trait.value;
    const meta = document.createElement("small");
    meta.textContent = `强度 ${Math.round((trait.strength || 0) * 100)}% · ${trait.evidenceCount || 0} 条证据`;
    card.append(title, value, meta);
    list.append(card);
  });
  if (!(profile.traits || []).length) {
    list.innerHTML = `<div class="empty">${participantNames().assistantName}的人格还在成长中。</div>`;
  }
}

function renderPromptSettings() {
  const bundle = state.promptBundle;
  if (!bundle) return;
  const settings = bundle.settings;
  $("#promptTone").value = settings.tone || "";
  $("#promptConversationStyle").value =
    settings.conversationStyle || "friend";
  $("#promptResponseLength").value = settings.responseLength || "balanced";
  $("#promptInitiative").value = String(
    Math.round((settings.initiative || 0) * 100)
  );
  $("#promptHumor").value = String(Math.round((settings.humor || 0) * 100));
  $("#promptUseEmoji").checked = Boolean(settings.useEmoji);
  $("#promptUseCatchphrases").checked = Boolean(settings.useCatchphrases);
  $("#promptBehaviorRules").value = (settings.behaviorRules || []).join("\n");
  $("#promptWorkInstruction").value = settings.workInstruction || "";
  $("#promptLifeInstruction").value = settings.lifeInstruction || "";
  $("#promptEmotionalInstruction").value =
    settings.emotionalInstruction || "";
  $("#promptProhibitedBehaviors").value = (
    settings.prohibitedBehaviors || []
  ).join("\n");
  $("#promptCustomInstruction").value = settings.customInstruction || "";
  $("#initiativeValue").textContent = `${$("#promptInitiative").value}%`;
  $("#humorValue").textContent = `${$("#promptHumor").value}%`;
  $("#promptVersionLabel").textContent = bundle.version
    ? `版本 ${bundle.version}`
    : "默认配置";

  const sections = $("#promptSectionList");
  sections.replaceChildren();
  bundle.sections.forEach((section) => {
    const card = document.createElement("article");
    card.className = `prompt-section${section.editable ? "" : " locked"}`;
    const header = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = section.title;
    const badge = document.createElement("span");
    badge.textContent = section.editable ? "可修改" : "系统锁定";
    const content = document.createElement("pre");
    content.textContent = section.content;
    header.append(title, badge);
    card.append(header, content);
    sections.append(card);
  });

  const versionSelect = $("#promptVersionSelect");
  versionSelect.replaceChildren(new Option("历史版本", ""));
  state.promptVersions.forEach((item) => {
    versionSelect.append(
      new Option(
        `版本 ${item.version} · ${new Date(item.createdAt).toLocaleString("zh-CN")}`,
        String(item.version)
      )
    );
  });
}

function renderPersonalityEvents() {
  const list = $("#personalityEventList");
  list.replaceChildren();
  state.personalityEvents.forEach((event) => {
    list.append(
      createTimelineRow(
        event.content,
        `${event.status === "active" ? "已生效" : "待确认"} · ${Math.round(event.confidence * 100)}%`,
        event.evidence,
        async () => {
          if (!confirm("确定删除这条人格变化记录吗？")) return;
          await window.desktop.deletePersonalityEvent(event.id);
          await loadAll();
        },
        event.status === "candidate"
          ? async () => {
              await window.desktop.confirmPersonalityEvent(event.id);
              await loadAll();
            }
          : null
      )
    );
  });
  if (!state.personalityEvents.length) {
    list.innerHTML = '<div class="empty">还没有人格变化记录。</div>';
  }
}

const SHARED_STATUS_GROUPS = [
  { status: "candidate", label: "待确认共同记忆", description: ({ userName }) => `需要${userName}确认后才会生效` },
  { status: "active", label: "已确认共同记忆", description: "我们共同的经历、决定与约定" }
];

function createSharedMemoryRow(memory) {
  const row = document.createElement("article");
  row.className = "memory-row shared-memory-row";
  const marker = createMemoryMarker("shared", "共同记忆");
  const content = document.createElement("div");
  content.className = "memory-content";
  const text = document.createElement("p");
  text.textContent = memory.content;
  const meta = document.createElement("div");
  meta.className = "memory-meta";
  const type = document.createElement("span");
  type.className = "memory-tag";
  type.textContent = TYPE_LABELS[memory.type] || memory.type;
  const status = document.createElement("span");
  status.textContent = memory.status === "active" ? "已确认" : "待确认";
  meta.append(type, status);
  content.append(text, meta);

  if (memory.evidence) {
    const excerpt = document.createElement("div");
    excerpt.className = "source-excerpt";
    excerpt.textContent = `来源原话："${memory.evidence}"`;
    content.append(excerpt);
  }

  const actions = document.createElement("div");
  actions.className = "memory-actions";
  if (memory.status === "candidate") {
    actions.append(
      actionButton("确认", async () => {
        await window.desktop.confirmSharedMemory(memory.id);
        await loadAll();
      }, "confirm")
    );
  }
  actions.append(
    actionButton("删除", async () => {
      if (!confirm("确定忘记这段共同记忆吗？")) return;
      await window.desktop.deleteSharedMemory(memory.id);
      await loadAll();
    }, "danger")
  );
  row.append(marker, content, actions);
  return row;
}

function renderSharedMemories() {
  const list = $("#sharedMemoryList");
  list.replaceChildren();

  SHARED_STATUS_GROUPS.forEach((groupInfo) => {
    const memories = state.sharedMemories.filter((m) => m.status === groupInfo.status);
    if (!memories.length) return;
    const group = document.createElement("section");
    group.className = `memory-group ${groupInfo.status}`;
    const header = document.createElement("header");
    header.innerHTML = `
      <div><i class="status-dot"></i><strong></strong><span></span></div>
      <span class="group-count"></span>`;
    header.querySelector("strong").textContent = groupInfo.label;
    header.querySelector("div span").textContent = groupDescription(groupInfo);
    header.querySelector(".group-count").textContent = `${memories.length} 条`;
    const rows = document.createElement("div");
    rows.className = "memory-list";
    memories.forEach((memory) => rows.append(createSharedMemoryRow(memory)));
    group.append(header, rows);
    list.append(group);
  });

  if (!state.sharedMemories.length) {
    list.innerHTML = '<div class="empty">我们还没有被记录下来的共同经历。</div>';
  }
}

function createTimelineRow(content, meta, evidence, onDelete, onConfirm = null) {
  const row = document.createElement("article");
  row.className = "timeline-row";
  const body = document.createElement("div");
  const text = document.createElement("strong");
  text.textContent = content;
  const detail = document.createElement("small");
  detail.textContent = meta;
  body.append(text, detail);
  if (evidence) {
    const source = document.createElement("p");
    source.textContent = `来源：“${evidence}”`;
    body.append(source);
  }
  const actions = document.createElement("div");
  actions.className = "timeline-actions";
  if (onConfirm) {
    const confirmButton = document.createElement("button");
    confirmButton.type = "button";
    confirmButton.className = "confirm";
    confirmButton.textContent = "确认";
    confirmButton.addEventListener("click", onConfirm);
    actions.append(confirmButton);
  }
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "danger";
  remove.textContent = "删除";
  remove.addEventListener("click", onDelete);
  actions.append(remove);
  row.append(body, actions);
  return row;
}

function parseKeyValueLines(value) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.search(/[:：]/);
      return separator < 0
        ? { key: line, value: "" }
        : {
            key: line.slice(0, separator).trim(),
            value: line.slice(separator + 1).trim()
          };
    })
    .filter((item) => item.key);
}

function renderPreferences() {
  const list = $("#preferenceList");
  list.replaceChildren();
  state.preferences.forEach((preference) => {
    const chip = document.createElement("div");
    chip.className = "preference-chip";
    const value =
      typeof preference.value === "string"
        ? preference.value
        : JSON.stringify(preference.value);
    chip.innerHTML = "<strong></strong><span></span><small></small>";
    chip.querySelector("strong").textContent = preference.key;
    chip.querySelector("span").textContent = value;
    chip.querySelector("small").textContent =
      preference.source === "explicit"
        ? "明确告知"
        : `AI 推测 ${Math.round(preference.confidence * 100)}%`;
    const remove = document.createElement("button");
    remove.className = "icon-btn";
    remove.textContent = "×";
    remove.title = "删除偏好";
    remove.addEventListener("click", async () => {
      await window.desktop.deletePreference(preference.id);
      await refreshPreferences();
    });
    chip.append(remove);
    list.append(chip);
  });
  if (!state.preferences.length) {
    list.innerHTML = '<div class="empty">还没有记录偏好。</div>';
  }
}

function visibleMemories() {
  const query = $("#memorySearch").value.trim().toLowerCase();
  const domain = $("#domainFilter").value;
  const status = $("#statusFilter").value;
  return state.memories.filter((memory) => {
    const searchText = `${memory.content} ${memory.entities.join(" ")}`.toLowerCase();
    return (
      (!query || searchText.includes(query)) &&
      (!domain || memory.domain === domain) &&
      (!status || memory.status === status)
    );
  });
}

function renderMemories() {
  const activeCount = state.memories.filter((memory) => memory.status === "active").length;
  const candidateCount = state.memories.filter((memory) => memory.status === "candidate").length;
  $("#totalMemoryCount").textContent = String(state.memories.length);
  $("#memoryCount").textContent = String(activeCount);
  $("#candidateMemoryCount").textContent = String(candidateCount);

  const list = $("#memoryList");
  list.replaceChildren();
  const visible = visibleMemories();

  STATUS_GROUPS.forEach((groupInfo) => {
    const memories = visible.filter((memory) => memory.status === groupInfo.status);
    if (!memories.length) return;
    const group = document.createElement("section");
    group.className = `memory-group ${groupInfo.status}`;
    const header = document.createElement("header");
    header.innerHTML = `
      <div><i class="status-dot"></i><strong></strong><span></span></div>
      <span class="group-count"></span>`;
    header.querySelector("strong").textContent = groupInfo.label;
    header.querySelector("div span").textContent = groupDescription(groupInfo);
    header.querySelector(".group-count").textContent = `${memories.length} 条`;
    const rows = document.createElement("div");
    rows.className = "memory-list";
    memories.forEach((memory) => rows.append(createMemoryRow(memory)));
    group.append(header, rows);
    list.append(group);
  });

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "memory-group empty";
    empty.textContent = state.memories.length
      ? "没有符合当前筛选条件的记忆。"
      : `${participantNames().assistantName}还没有长期记忆。可以写下一件值得记住的事。`;
    list.append(empty);
  }
}

function createMemoryRow(memory) {
  const row = document.createElement("article");
  const domainKey = DOMAIN_ICONS[memory.domain] ? memory.domain : "profile";
  row.className = `memory-row domain-${domainKey}`;
  const marker = createMemoryMarker(
    domainKey,
    DOMAIN_LABELS[memory.domain] || memory.domain
  );
  const content = document.createElement("div");
  content.className = "memory-content";
  const text = document.createElement("p");
  text.textContent = memory.content;
  const meta = document.createElement("div");
  meta.className = "memory-meta";
  const domain = document.createElement("span");
  domain.className = "memory-tag";
  domain.textContent = DOMAIN_LABELS[memory.domain] || memory.domain;
  const type = document.createElement("span");
  type.textContent = TYPE_LABELS[memory.type] || memory.type;
  const source = document.createElement("span");
  source.textContent =
    memory.source === "explicit"
      ? `${participantNames().userName}明确告知`
      : memory.source === "inferred"
        ? `${participantNames().assistantName}推测`
        : "导入";
  const confidence = document.createElement("span");
  confidence.textContent = `置信度 ${Math.round(memory.confidence * 100)}%`;
  const validity = document.createElement("span");
  validity.textContent = formatDate(memory.validUntil);
  meta.append(domain, type, source, confidence, validity);
  if (memory.mergeCount > 1) {
    const merged = document.createElement("span");
    merged.textContent = `${memory.mergeCount} 份证据`;
    meta.append(merged);
  }
  content.append(text, meta);

  if (memory.sourceExcerpt) {
    const excerpt = document.createElement("div");
    excerpt.className = "source-excerpt";
    excerpt.textContent = `来源原话：“${memory.sourceExcerpt}”`;
    content.append(excerpt);
  }

  const actions = document.createElement("div");
  actions.className = "memory-actions";
  if (memory.status === "candidate") {
    actions.append(actionButton("确认", () => confirmMemory(memory.id), "confirm"));
  }
  actions.append(actionButton("编辑", () => editMemory(memory)));
  actions.append(actionButton("忘记", () => deleteMemory(memory.id), "danger"));
  row.append(marker, content, actions);
  return row;
}

function createMemoryMarker(iconKey, label) {
  const marker = document.createElement("div");
  marker.className = "memory-domain-mark";
  marker.title = label;
  marker.setAttribute("aria-label", label);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  for (const pathData of DOMAIN_ICONS[iconKey] || DOMAIN_ICONS.profile) {
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", pathData);
    svg.append(path);
  }
  marker.append(svg);
  return marker;
}

function actionButton(text, handler, className = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = text;
  button.className = className;
  button.addEventListener("click", handler);
  return button;
}

async function refreshPreferences() {
  state.preferences = await window.desktop.listPreferences();
  renderPreferences();
}

async function refreshMemories() {
  state.memories = await window.desktop.listMemories();
  renderMemories();
}

async function confirmMemory(id) {
  await window.desktop.confirmMemory(id);
  showNotice(`这条记忆已经由${participantNames().userName}确认。`);
  await refreshMemories();
}

async function saveMemorySettings(changes) {
  state.settings = await window.desktop.saveMemorySettings({
    autoConfirm: Boolean(state.settings.autoConfirm),
    autoConfirmAll: Boolean(state.settings.autoConfirmAll),
    ...changes
  });
  renderMemorySettings();
}

function openMemoryEditor(editing = false) {
  $("#memoryEditorTitle").textContent = editing ? "编辑记忆" : "新增记忆";
  $("#memoryEditor").classList.remove("hidden");
  $("#memoryContent").focus();
}

function editMemory(memory) {
  $("#memoryId").value = memory.id;
  $("#memoryContent").value = memory.content;
  $("#memoryDomain").value = memory.domain;
  $("#memoryType").value = memory.type;
  $("#memorySensitivity").value = memory.sensitivity;
  $("#memoryEntities").value = memory.entities.join(", ");
  $("#memorySubmitText").textContent = "保存修改";
  openMemoryEditor(true);
}

function resetMemoryForm() {
  $("#memoryForm").reset();
  $("#memoryId").value = "";
  $("#memorySubmitText").textContent = "记住这件事";
  $("#memoryEditor").classList.add("hidden");
}

async function deleteMemory(id) {
  if (!confirm(`确定让${participantNames().assistantName}忘记这条记忆吗？删除后无法恢复。`)) return;
  await window.desktop.deleteMemory(id);
  showNotice("这条记忆已经彻底删除。");
  await refreshMemories();
}

document.querySelectorAll(".memory-tab").forEach((button) => {
  button.addEventListener("click", () => switchView(button.dataset.view));
});

$("#addMemoryBtn").addEventListener("click", () => {
  resetMemoryForm();
  openMemoryEditor(false);
});
$("#closeMemoryEditor").addEventListener("click", resetMemoryForm);
$("#cancelMemoryEdit").addEventListener("click", resetMemoryForm);
$("#memorySearch").addEventListener("input", renderMemories);
$("#domainFilter").addEventListener("change", renderMemories);
$("#statusFilter").addEventListener("change", renderMemories);
$("#autoConfirmMemory").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  input.disabled = true;
  const allInput = $("#autoConfirmAllMemory");
  allInput.disabled = true;
  try {
    await saveMemorySettings({
      autoConfirm: input.checked,
      autoConfirmAll: input.checked
        ? Boolean(state.settings.autoConfirmAll)
        : false
    });
    showNotice(
      state.settings.autoConfirm
        ? "自动确认已开启。"
        : "自动确认已关闭。"
    );
  } catch (error) {
    input.checked = !input.checked;
    showNotice(error.message, true);
  } finally {
    input.disabled = false;
    renderMemorySettings();
  }
});

$("#autoConfirmAllMemory").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const autoInput = $("#autoConfirmMemory");
  input.disabled = true;
  autoInput.disabled = true;
  try {
    await saveMemorySettings({
      autoConfirm: input.checked || Boolean(state.settings.autoConfirm),
      autoConfirmAll: input.checked
    });
    showNotice(
      state.settings.autoConfirmAll
        ? "无条件自动确认已开启；所有新记忆候选都会直接生效。"
        : "无条件自动确认已关闭。"
    );
  } catch (error) {
    input.checked = !input.checked;
    showNotice(error.message, true);
  } finally {
    autoInput.disabled = false;
    renderMemorySettings();
  }
});

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state.profile = await window.desktop.saveProfile({
      displayName: $("#displayName").value,
      preferredName: $("#preferredName").value,
      birthday: $("#birthday").value,
      occupation: $("#occupation").value,
      bio: $("#bio").value,
      goals: $("#goals").value.split("\n").map((item) => item.trim()).filter(Boolean)
    });
    showNotice("用户画像已保存。");
  } catch (error) {
    showNotice(error.message, true);
  }
});

$("#assistantProfileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state.assistantProfile = await window.desktop.updateAssistantProfile({
      name: $("#assistantName").value,
      gender: $("#assistantGender").value,
      selfDefinition: $("#assistantDefinition").value,
      relationshipSummary: $("#assistantRelationship").value,
      values: parseKeyValueLines($("#assistantValues").value)
    });
    state.promptBundle = await window.desktop.getPromptSettings();
    renderAssistantProfile();
    renderPromptSettings();
    window.parent?.postMessage({ type: "xuan:prompt-updated" }, "*");
    showNotice("人格画像已经更新。");
  } catch (error) {
    showNotice(error.message, true);
  }
});

$("#promptInitiative").addEventListener("input", (event) => {
  $("#initiativeValue").textContent = `${event.currentTarget.value}%`;
});
$("#promptHumor").addEventListener("input", (event) => {
  $("#humorValue").textContent = `${event.currentTarget.value}%`;
});

$("#promptSettingsForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state.promptBundle = await window.desktop.savePromptSettings({
      tone: $("#promptTone").value,
      conversationStyle: $("#promptConversationStyle").value,
      responseLength: $("#promptResponseLength").value,
      initiative: Number($("#promptInitiative").value) / 100,
      humor: Number($("#promptHumor").value) / 100,
      useEmoji: $("#promptUseEmoji").checked,
      useCatchphrases: $("#promptUseCatchphrases").checked,
      behaviorRules: splitLines($("#promptBehaviorRules").value),
      workInstruction: $("#promptWorkInstruction").value,
      lifeInstruction: $("#promptLifeInstruction").value,
      emotionalInstruction: $("#promptEmotionalInstruction").value,
      prohibitedBehaviors: splitLines(
        $("#promptProhibitedBehaviors").value
      ),
      customInstruction: $("#promptCustomInstruction").value
    });
    state.promptVersions = await window.desktop.listPromptVersions();
    renderPromptSettings();
    window.parent?.postMessage({ type: "xuan:prompt-updated" }, "*");
    showNotice("提示词设置已保存并立即生效。");
  } catch (error) {
    showNotice(error.message, true);
  }
});

$("#restorePromptVersion").addEventListener("click", async () => {
  const version = $("#promptVersionSelect").value;
  if (!version) {
    showNotice("请先选择要恢复的历史版本。", true);
    return;
  }
  try {
    state.promptBundle = await window.desktop.restorePromptVersion(version);
    state.promptVersions = await window.desktop.listPromptVersions();
    renderPromptSettings();
    window.parent?.postMessage({ type: "xuan:prompt-updated" }, "*");
    showNotice(`已恢复版本 ${version}，并生成了一个新版本。`);
  } catch (error) {
    showNotice(error.message, true);
  }
});

window.addEventListener("message", (event) => {
  if (event.data?.type === "xuan:refresh-memory") {
    loadAll().catch((error) => showNotice(error.message, true));
  }
});

function splitLines(value) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

$("#preferenceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await window.desktop.savePreference({
      category: $("#preferenceCategory").value,
      key: $("#preferenceKey").value,
      value: $("#preferenceValue").value,
      source: "explicit",
      confidence: 1,
      sensitivity: $("#preferenceSensitivity").value
    });
    event.target.reset();
    showNotice("偏好已保存。");
    await refreshPreferences();
  } catch (error) {
    showNotice(error.message, true);
  }
});

$("#memoryForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const id = $("#memoryId").value;
  const payload = {
    content: $("#memoryContent").value,
    domain: $("#memoryDomain").value,
    type: $("#memoryType").value,
    sensitivity: $("#memorySensitivity").value,
    entities: $("#memoryEntities").value
      .split(/[,，]/)
      .map((item) => item.trim())
      .filter(Boolean),
    source: "explicit",
    confidence: 1,
    status: "active"
  };
  try {
    if (id) await window.desktop.updateMemory(id, payload);
    else await window.desktop.createMemory(payload);
    resetMemoryForm();
    showNotice(id ? "记忆已修改。" : `${participantNames().assistantName}记住啦。`);
    await refreshMemories();
  } catch (error) {
    showNotice(error.message, true);
  }
});

$("#homeBtn").addEventListener("click", () => navigate("chat", "home.html"));
$("#todoBtn").addEventListener("click", () => navigate("todo", "index.html"));
$("#modulesBtn").addEventListener("click", () => navigate("modules", "modules.html"));
$("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
$("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
$("#closeBtn").addEventListener("click", () => window.desktop.close());

loadAll().catch((error) => showNotice(`无法加载记忆中心：${error.message}`, true));
