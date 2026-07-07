const params = new URLSearchParams(window.location.search);
const kind = params.get("kind") === "user" ? "user" : "assistant";
if (params.has("embedded")) {
  document.body.classList.add("embedded");
  if (!window.desktop && window.parent?.desktop) {
    window.desktop = window.parent.desktop;
  }
}

const $ = (selector) => document.querySelector(selector);
const cropper = new window.AetherAvatarCropper($("#avatarCropModal"));
let profile = null;
let personalityEvents = [];
let journals = [];
let journalFilter = "all";
let galleryImages = [];
let galleryFilter = "all";

function showNotice(message, error = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice${error ? " error" : ""}`;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => notice.classList.add("hidden"), 2800);
}

function parseKeyValueLines(value) {
  return String(value)
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

function renderAvatar() {
  const image = $("#avatarImage");
  const fallback = $("#avatarFallback");
  const dataUrl = profile?.avatarDataUrl || "";
  const name =
    kind === "user"
      ? profile?.displayName || profile?.preferredName || "洛尼"
      : profile?.name || "小玄";
  image.classList.toggle("hidden", !dataUrl);
  fallback.classList.toggle("hidden", Boolean(dataUrl));
  image.src = dataUrl;
  image.alt = `${name}的头像`;
  fallback.textContent = name.slice(0, 1);
  $("#heroName").textContent = name;
  $("#removeAvatar").disabled = !dataUrl;
}

function renderUser() {
  $("#pageEyebrow").textContent = "PERSONAL SPACE";
  $("#pageTitle").textContent = "个人主页";
  $("#profileRole").textContent = "USER PROFILE";
  $("#heroSummary").textContent =
    profile.bio || profile.occupation || "属于洛尼的个人空间";
  $("#userSection").classList.remove("hidden");
  $("#userDisplayName").value = profile.displayName || "";
  $("#userPreferredName").value = profile.preferredName || "";
  $("#userBirthday").value = profile.birthday || "";
  $("#userOccupation").value = profile.occupation || "";
  $("#userBio").value = profile.bio || "";
  $("#userGoals").value = (profile.goals || []).join("\n");
}

function renderAssistant() {
  $("#pageEyebrow").textContent = "AI PARTNER · PERSONAL SPACE";
  $("#pageTitle").textContent = "AI 伙伴主页";
  $("#profileRole").textContent = "DIGITAL COMPANION";
  $("#heroSummary").textContent =
    profile.selfDefinition || "会持续成长的全能助手";
  $("#assistantSection").classList.remove("hidden");
  $("#personaImageSection").classList.remove("hidden");
  $("#journalSection").classList.remove("hidden");
  $("#gallerySection").classList.remove("hidden");
  $("#growthSection").classList.remove("hidden");
  $("#assistantName").value = profile.name || "";
  $("#assistantGender").value = profile.gender || "";
  $("#assistantDefinition").value = profile.selfDefinition || "";
  $("#assistantRelationship").value = profile.relationshipSummary || "";
  $("#assistantValues").value = (profile.values || [])
    .map((item) => `${item.key}：${item.value}`)
    .join("\n");
  $("#journalHeading").textContent = `${profile.name || "AI 伙伴"}手记`;
  const list = $("#traitList");
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
    list.innerHTML = '<div class="empty">AI 伙伴的人格还在成长中。</div>';
  }
  renderPersonalityTimeline();
  renderJournals();
  renderGallery();
}

function renderPersonaImage() {
  const image = $("#personaImage");
  const fallback = $("#personaImageFallback");
  const preview = $("#personaImagePreview");
  const dataUrl = profile?.personaImageDataUrl || "";
  image.classList.toggle("hidden", !dataUrl);
  fallback.classList.toggle("hidden", Boolean(dataUrl));
  preview.classList.toggle("empty", !dataUrl);
  image.src = dataUrl;
  $("#removePersonaImage").disabled = !dataUrl;
}

function renderJournals() {
  const list = $("#journalList");
  list.replaceChildren();
  journals
    .filter((journal) => journalFilter === "all" || journal.type === journalFilter)
    .forEach((journal) => {
      const card = document.createElement("article");
      card.className = "journal-card";
      const header = document.createElement("header");
      const title = document.createElement("h3");
      title.textContent = journal.title;
      const controls = document.createElement("div");
      controls.className = "journal-card-controls";
      const time = document.createElement("time");
      time.textContent = journal.periodKey;
      const remove = document.createElement("button");
      remove.className = "journal-delete";
      remove.type = "button";
      remove.textContent = "删除";
      remove.title = "删除这篇手记";
      remove.addEventListener("click", () => deleteJournal(journal));
      controls.append(time, remove);
      header.append(title, controls);
      const content = document.createElement("div");
      content.className = "journal-content";
      if (window.XuanMarkdown?.render) {
        window.XuanMarkdown.render(content, journal.content);
      } else {
        content.classList.add("plain");
        content.textContent = journal.content;
      }
      const meta = document.createElement("div");
      meta.className = "journal-meta";
      const kindLabel = document.createElement("span");
      kindLabel.className = "journal-kind";
      kindLabel.textContent = journal.type === "daily" ? "日记" : "周记";
      const mood = document.createElement("span");
      mood.textContent = journal.mood || "平静";
      const sources = document.createElement("span");
      sources.textContent = `${journal.sourceMessageCount || 0} 条原始消息`;
      meta.append(kindLabel, mood, sources);
      card.append(header, content, meta);
      list.append(card);
    });
  if (!list.children.length) {
    list.innerHTML =
      '<div class="empty">还没有手记。完成一个自然日或完整一周后，她会自己写下来。</div>';
  }
}

function renderGallery() {
  const grid = $("#galleryGrid");
  grid.replaceChildren();
  const visible = galleryImages.filter(
    (image) => galleryFilter === "all" || image.origin === galleryFilter
  );
  visible.forEach((image) => {
    const figure = document.createElement("figure");
    figure.className = "gallery-item";
    const img = document.createElement("img");
    img.src = image.source;
    img.alt = image.description || "她画的图";
    img.loading = "lazy";
    const badge = document.createElement("span");
    badge.className = `gallery-badge gallery-badge-${image.origin}`;
    badge.textContent = image.origin === "journal" ? "手记" : "对话";
    figure.append(img, badge);
    figure.addEventListener("click", () => openLightbox(image));
    grid.append(figure);
  });
  if (!grid.children.length) {
    grid.innerHTML =
      '<div class="empty">相册还是空的。当她在对话或手记里画下画面时，会收进这里。</div>';
  }
}

function openLightbox(image) {
  const lightbox = $("#galleryLightbox");
  const img = $("#galleryLightboxImage");
  const caption = $("#galleryLightboxCaption");
  img.src = image.source;
  img.alt = image.description || "";
  const originLabel = image.origin === "journal" ? "手记" : "对话";
  const from = image.refTitle ? ` · 来自${originLabel}《${image.refTitle}》` : ` · 来自${originLabel}`;
  caption.textContent = (image.description || "").concat(from);
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  $("#galleryLightbox").classList.add("hidden");
}

function renderPersonalityTimeline() {
  $("#personalityTimelineSection").classList.remove("hidden");
  const timeline = $("#personalityTimeline");
  timeline.replaceChildren();
  personalityEvents.forEach((event) => {
    const card = document.createElement("article");
    card.className = "timeline-card";
    const dot = document.createElement("i");
    dot.className = "timeline-dot";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent =
      event.traitKey || event.category || "一次新的成长";
    const content = document.createElement("p");
    content.textContent = event.content;
    const meta = document.createElement("small");
    const date = new Date(event.createdAt);
    const dateLabel = Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString("zh-CN");
    meta.textContent = [
      event.status === "candidate" ? "待确认" : "已生效",
      dateLabel
    ].filter(Boolean).join(" · ");
    copy.append(title, content, meta);
    card.append(dot, copy);
    timeline.append(card);
  });
  if (!personalityEvents.length) {
    timeline.innerHTML = '<div class="empty">还没有人格成长记录。</div>';
  }
}

function render() {
  renderAvatar();
  if (kind === "user") renderUser();
  else {
    renderAssistant();
    renderPersonaImage();
  }
}

async function loadProfile() {
  if (kind === "user") {
    profile = await window.desktop.getProfile();
  } else {
    [profile, personalityEvents, journals, galleryImages] = await Promise.all([
      window.desktop.getAssistantProfile(),
      window.desktop.listPersonalityEvents(),
      window.desktop.listJournals({ limit: 50 }),
      window.desktop.listAssistantGallery({ limit: 120 })
    ]);
  }
  render();
}

async function deleteJournal(journal) {
  if (!window.confirm(`确定删除《${journal.title}》吗？`)) return;
  try {
    await window.desktop.deleteJournal(journal.id);
    journals = journals.filter((item) => item.id !== journal.id);
    renderJournals();
    showNotice("手记已经删除。");
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function saveAvatar(dataUrl) {
  profile =
    kind === "user"
      ? await window.desktop.updateProfile({ avatarDataUrl: dataUrl })
      : await window.desktop.updateAssistantProfile({ avatarDataUrl: dataUrl });
  renderAvatar();
  window.parent?.postMessage(
    { type: "aether:profile-updated", kind },
    "*"
  );
  showNotice(dataUrl ? "头像已经更新。" : "头像已经移除。");
}

$("#chooseAvatar").addEventListener("click", () => $("#avatarFile").click());
$("#avatarButton").addEventListener("click", () => $("#avatarFile").click());
$("#avatarFile").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) return;
  try {
    const dataUrl = await cropper.open(file);
    if (dataUrl) await saveAvatar(dataUrl);
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#removeAvatar").addEventListener("click", async () => {
  try {
    await saveAvatar("");
  } catch (error) {
    showNotice(error.message, true);
  }
});

const MAX_PERSONA_IMAGE_BYTES = 4 * 1024 * 1024;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("读取图片失败，请换一张试试。"));
    reader.readAsDataURL(file);
  });
}

async function savePersonaImage(dataUrl) {
  profile = await window.desktop.updateAssistantProfile({
    personaImageDataUrl: dataUrl
  });
  renderPersonaImage();
  showNotice(dataUrl ? "人设参考图已经更新。" : "人设参考图已经移除。");
}

$("#choosePersonaImage").addEventListener("click", () =>
  $("#personaImageFile").click()
);
$("#personaImageFile").addEventListener("change", async (event) => {
  const file = event.currentTarget.files?.[0];
  event.currentTarget.value = "";
  if (!file) return;
  if (file.size > MAX_PERSONA_IMAGE_BYTES) {
    showNotice("人设图大小不能超过 4MB。", true);
    return;
  }
  try {
    const dataUrl = await readFileAsDataUrl(file);
    await savePersonaImage(dataUrl);
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#removePersonaImage").addEventListener("click", async () => {
  try {
    await savePersonaImage("");
  } catch (error) {
    showNotice(error.message, true);
  }
});
$("#backToChat").addEventListener("click", () => {
  if (document.body.classList.contains("embedded")) {
    window.parent.postMessage({ type: "xuan:navigate", target: "chat" }, "*");
  } else {
    window.location.href = "home.html";
  }
});

document.querySelectorAll(".journal-tab").forEach((button) => {
  button.addEventListener("click", () => {
    journalFilter = button.dataset.journalType;
    document.querySelectorAll(".journal-tab").forEach((item) =>
      item.classList.toggle("active", item === button)
    );
    renderJournals();
  });
});

document.querySelectorAll(".gallery-tab").forEach((button) => {
  button.addEventListener("click", () => {
    galleryFilter = button.dataset.galleryOrigin;
    document.querySelectorAll(".gallery-tab").forEach((item) =>
      item.classList.toggle("active", item === button)
    );
    renderGallery();
  });
});

$("#galleryLightbox").addEventListener("click", (event) => {
  if (event.target === $("#galleryLightbox") || event.target.closest("[data-gallery-close]")) {
    closeLightbox();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeLightbox();
});

window.addEventListener("message", async (event) => {
  if (kind !== "assistant") return;
  const type = event.data?.type;
  if (type === "aether:journals-updated") {
    [journals, galleryImages] = await Promise.all([
      window.desktop.listJournals({ limit: 50 }),
      window.desktop.listAssistantGallery({ limit: 120 })
    ]);
    renderJournals();
    renderGallery();
  } else if (type === "aether:gallery-updated") {
    galleryImages = await window.desktop.listAssistantGallery({ limit: 120 });
    renderGallery();
  }
});

$("#userProfileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    profile = await window.desktop.saveProfile({
      displayName: $("#userDisplayName").value,
      preferredName: $("#userPreferredName").value,
      birthday: $("#userBirthday").value,
      occupation: $("#userOccupation").value,
      bio: $("#userBio").value,
      goals: $("#userGoals").value
        .split("\n")
        .map((item) => item.trim())
        .filter(Boolean)
    });
    render();
    window.parent?.postMessage(
      { type: "aether:profile-updated", kind },
      "*"
    );
    showNotice("个人主页已经保存。");
  } catch (error) {
    showNotice(error.message, true);
  }
});

$("#assistantProfileForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    profile = await window.desktop.updateAssistantProfile({
      name: $("#assistantName").value,
      gender: $("#assistantGender").value,
      selfDefinition: $("#assistantDefinition").value,
      relationshipSummary: $("#assistantRelationship").value,
      values: parseKeyValueLines($("#assistantValues").value)
    });
    render();
    window.parent?.postMessage(
      { type: "aether:profile-updated", kind },
      "*"
    );
    window.parent?.postMessage({ type: "xuan:prompt-updated" }, "*");
    showNotice("AI 主页已经保存。");
  } catch (error) {
    showNotice(error.message, true);
  }
});

loadProfile().catch((error) => showNotice(error.message, true));
