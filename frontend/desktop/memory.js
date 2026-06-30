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

function showNotice(message, error = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice${error ? " error" : ""}`;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => notice.classList.add("hidden"), 3200);
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium" }).format(value) : "长期";
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
    chip.innerHTML = `<strong></strong><span></span><small></small>`;
    chip.querySelector("strong").textContent = preference.key;
    chip.querySelector("span").textContent = value;
    chip.querySelector("small").textContent =
      preference.source === "explicit" ? "明确告知" : `AI 推测 ${Math.round(preference.confidence * 100)}%`;
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
  if (!state.preferences.length) list.innerHTML = '<div class="empty">还没有记录偏好。</div>';
}

function renderMemories() {
  const list = $("#memoryList");
  list.replaceChildren();
  $("#memoryCount").textContent = String(
    state.memories.filter((memory) => memory.status === "active").length
  );
  state.memories.forEach((memory) => {
    const card = document.createElement("article");
    card.className = `memory-card ${memory.status}`;
    const statusText = { active: "已确认", candidate: "待确认", archived: "已归档" }[memory.status];
    card.innerHTML = `
      <div class="memory-card-top"><div><span class="badge"></span> <span class="badge status"></span></div></div>
      <p></p><div class="meta"></div><div class="memory-card-actions"></div>`;
    card.querySelector(".badge").textContent = `${memory.domain} · ${memory.type}`;
    const status = card.querySelector(".status");
    status.textContent = statusText;
    if (memory.status === "candidate") status.classList.add("warning");
    card.querySelector("p").textContent = memory.content;
    const meta = card.querySelector(".meta");
    const source = memory.source === "explicit" ? "洛尼明确告知" : memory.source === "inferred" ? "AI 推测" : "导入";
    meta.textContent = `来源：${source}　置信度：${Math.round(memory.confidence * 100)}%　敏感级别：${memory.sensitivity}　有效期：${formatDate(memory.validUntil)}`;
    if (memory.entities.length) meta.textContent += `　相关：${memory.entities.join("、")}`;
    if (memory.sourceExcerpt) {
      const excerpt = document.createElement("div");
      excerpt.className = "source-excerpt";
      excerpt.textContent = `原话：“${memory.sourceExcerpt}”`;
      card.insertBefore(excerpt, card.querySelector(".memory-card-actions"));
    }
    const actions = card.querySelector(".memory-card-actions");
    if (memory.status === "candidate") actions.append(actionButton("确认记住", () => confirmMemory(memory.id)));
    actions.append(actionButton("编辑", () => editMemory(memory)));
    actions.append(actionButton("忘记", () => deleteMemory(memory.id), "danger"));
    list.append(card);
  });
  if (!state.memories.length) list.innerHTML = '<div class="empty">还没有长期记忆。可以先亲自告诉小玄一件重要的事。</div>';
}

function actionButton(text, handler, className = "") {
  const button = document.createElement("button");
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
  state.memories = await window.desktop.listMemories({
    q: $("#memorySearch").value.trim(),
    status: $("#statusFilter").value
  });
  renderMemories();
}

async function confirmMemory(id) {
  await window.desktop.confirmMemory(id);
  showNotice("这条记忆已经由洛尼确认。");
  await refreshMemories();
}

function editMemory(memory) {
  $("#memoryId").value = memory.id;
  $("#memoryContent").value = memory.content;
  $("#memoryDomain").value = memory.domain;
  $("#memoryType").value = memory.type;
  $("#memorySensitivity").value = memory.sensitivity;
  $("#memoryEntities").value = memory.entities.join(", ");
  $("#memorySubmitText").textContent = "保存修改";
  $("#cancelMemoryEdit").classList.remove("hidden");
  $("#memoryContent").focus();
}

function resetMemoryForm() {
  $("#memoryForm").reset();
  $("#memoryId").value = "";
  $("#memorySubmitText").textContent = "记住这件事";
  $("#cancelMemoryEdit").classList.add("hidden");
}

async function deleteMemory(id) {
  if (!confirm("确定让小玄忘记这条记忆吗？删除后无法恢复。")) return;
  await window.desktop.deleteMemory(id);
  showNotice("这条记忆已经彻底删除。");
  await refreshMemories();
}

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
    entities: $("#memoryEntities").value.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
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

$("#cancelMemoryEdit").addEventListener("click", resetMemoryForm);
$("#memorySearch").addEventListener("input", () => {
  clearTimeout(refreshMemories.timer);
  refreshMemories.timer = setTimeout(() => refreshMemories().catch((error) => showNotice(error.message, true)), 250);
});
$("#statusFilter").addEventListener("change", () => refreshMemories().catch((error) => showNotice(error.message, true)));
$("#homeBtn").addEventListener("click", () => navigate("chat", "home.html"));
$("#todoBtn").addEventListener("click", () => navigate("todo", "index.html"));
$("#modulesBtn").addEventListener("click", () => navigate("modules", "modules.html"));
$("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
$("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
$("#closeBtn").addEventListener("click", () => window.desktop.close());

loadAll().catch((error) => showNotice(`无法加载记忆中心：${error.message}`, true));
