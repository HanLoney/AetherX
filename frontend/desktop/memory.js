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

const state = { profile: null, preferences: [], memories: [] };
const $ = (selector) => document.querySelector(selector);
const DOMAIN_LABELS = {
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
const STATUS_GROUPS = [
  { status: "candidate", label: "待确认记忆", description: "需要洛尼确认后才会参与召回" },
  { status: "active", label: "已确认记忆", description: "小玄会在相关场景中主动参考" },
  { status: "archived", label: "已归档记忆", description: "保留记录，但不会参与召回" }
];

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
  const [profile, preferences, memories] = await Promise.all([
    window.desktop.getProfile(),
    window.desktop.listPreferences(),
    window.desktop.listMemories()
  ]);
  state.profile = profile;
  state.preferences = preferences;
  state.memories = memories;
  renderProfile();
  renderPreferences();
  renderMemories();
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
  $("#occupation").value = profile.occupation || "";
  $("#bio").value = profile.bio || "";
  $("#goals").value = (profile.goals || []).join("\n");
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
    header.querySelector("div span").textContent = groupInfo.description;
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
      : "小玄还没有长期记忆。可以点击“新增记忆”告诉我一件重要的事。";
    list.append(empty);
  }
}

function createMemoryRow(memory) {
  const row = document.createElement("article");
  row.className = "memory-row";
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
    memory.source === "explicit" ? "洛尼明确告知" : memory.source === "inferred" ? "AI 推测" : "导入";
  const confidence = document.createElement("span");
  confidence.textContent = `置信度 ${Math.round(memory.confidence * 100)}%`;
  const validity = document.createElement("span");
  validity.textContent = formatDate(memory.validUntil);
  meta.append(domain, type, source, confidence, validity);
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
  row.append(content, actions);
  return row;
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
  showNotice("这条记忆已经由洛尼确认。");
  await refreshMemories();
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
  if (!confirm("确定让小玄忘记这条记忆吗？删除后无法恢复。")) return;
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

$("#profileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    state.profile = await window.desktop.saveProfile({
      displayName: $("#displayName").value,
      preferredName: $("#preferredName").value,
      occupation: $("#occupation").value,
      bio: $("#bio").value,
      goals: $("#goals").value.split("\n").map((item) => item.trim()).filter(Boolean)
    });
    showNotice("用户画像已保存。");
  } catch (error) {
    showNotice(error.message, true);
  }
});

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
    showNotice(id ? "记忆已修改。" : "小玄记住啦。");
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
