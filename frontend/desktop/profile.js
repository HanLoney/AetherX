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
const GALLERY_OVERVIEW_LIMIT = 3;
const GALLERY_PAGE_SIZE = 6;
let profile = null;
let personalityEvents = [];
let journals = [];
const journalPager = new window.AetherJournalPager();
let journalTurnDirection = "";
let galleryImages = [];
let galleryTotal = 0;
let galleryHasMore = false;
let galleryLoading = kind === "assistant";
let galleryLoadError = "";
let galleryLoadPromise = null;
let galleryFilter = "all";
let assistantView = "overview";
const assistantContentState = {
  growth: { loading: kind === "assistant", error: "" },
  journals: { loading: kind === "assistant", error: "" }
};

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
  const assistantRemove = $("#removeAssistantAvatar");
  if (assistantRemove) assistantRemove.disabled = !dataUrl;
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
  document.body.classList.add("assistant-profile");
  $("#pageEyebrow").textContent = "AI PARTNER · PERSONAL SPACE";
  $("#pageTitle").textContent = `${profile.name || "AI 伙伴"}的空间`;
  $("#profileRole").textContent = "DIGITAL COMPANION";
  $("#heroSummary").textContent =
    "生活在数字空间，也在与你相处中慢慢成为自己";
  $("#assistantTabs").classList.remove("hidden");
  $("#editAssistantProfile").classList.remove("hidden");
  $("#heroRelationship").classList.remove("hidden");
  document.querySelector(".avatar-actions").classList.add("hidden");
  $("#assistantSection").classList.remove("hidden");
  $("#personaImageSection").classList.remove("hidden");
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
  const traits = profile.traits || [];
  $("#growthTraitCount").textContent = String(traits.length);
  $("#growthEventCount").textContent = assistantContentState.growth.loading
    ? "…"
    : String(personalityEvents.length);
  traits.forEach((trait, index) => {
    const card = document.createElement("article");
    card.className = `trait-card trait-tone-${index % 3}`;
    const strength = Math.max(0, Math.min(100, Math.round((trait.strength || 0) * 100)));
    card.style.setProperty("--trait-strength", `${strength}%`);
    const heading = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = window.XuanGrowthLanguage.growthTitle({
      traitKey: trait.key,
      category: "growth"
    });
    const percentage = document.createElement("span");
    percentage.textContent = `${strength}%`;
    heading.append(title, percentage);
    const value = document.createElement("p");
    value.textContent = window.XuanGrowthLanguage.growthTraitDescription(trait);
    const meter = document.createElement("div");
    meter.className = "trait-meter";
    meter.setAttribute("role", "meter");
    meter.setAttribute("aria-label", `${trait.key}的形成强度`);
    meter.setAttribute("aria-valuemin", "0");
    meter.setAttribute("aria-valuemax", "100");
    meter.setAttribute("aria-valuenow", String(strength));
    meter.append(document.createElement("i"));
    const meta = document.createElement("small");
    meta.textContent = `${trait.evidenceCount || 0} 次相处印证`;
    card.append(heading, value, meter, meta);
    list.append(card);
  });
  if (!traits.length) {
    list.innerHTML = '<div class="empty">AI 伙伴的人格还在成长中。</div>';
  }
  renderPersonalityTimeline();
  renderJournals();
  renderGallery();
  renderAssistantOverview();
  setAssistantView(assistantView);
}

function setAssistantView(view) {
  const allowed = ["overview", "journal", "gallery", "growth"];
  assistantView = allowed.includes(view) ? view : "overview";
  document.querySelectorAll("[data-assistant-view]").forEach((panel) => {
    panel.classList.toggle("hidden", panel.dataset.assistantView !== assistantView);
  });
  document.querySelectorAll("[data-profile-view]").forEach((button) => {
    const active = button.dataset.profileView === assistantView;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (assistantView === "gallery" && galleryHasMore) {
    void loadMoreGallery().catch(showGalleryLoadFailure);
  }
}

function renderAssistantOverview() {
  $("#overviewRelationship").textContent =
    profile.relationshipSummary || "一起生活、一起成长的数字伙伴。";
  $("#overviewJournalCount").textContent = assistantContentState.journals.loading
    ? "…"
    : String(journals.length);
  $("#overviewGalleryCount").textContent = galleryLoading && !galleryTotal
    ? "…"
    : String(galleryTotal);
  $("#overviewGrowthCount").textContent = assistantContentState.growth.loading
    ? "…"
    : String(personalityEvents.length);

  const journalHost = $("#overviewLatestJournal");
  journalHost.replaceChildren();
  const latestJournal = journals[0];
  if (latestJournal) {
    const title = document.createElement("strong");
    title.textContent = latestJournal.title;
    const excerpt = document.createElement("p");
    excerpt.textContent = String(latestJournal.content || "")
      .replace(/[#>*_`\[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150);
    const meta = document.createElement("small");
    meta.textContent = `${latestJournal.type === "daily" ? "日记" : "周记"} · ${latestJournal.periodKey}`;
    journalHost.append(title, excerpt, meta);
  } else if (assistantContentState.journals.loading) {
    journalHost.innerHTML = '<div class="empty">手记正在慢慢翻开…</div>';
  } else if (assistantContentState.journals.error) {
    journalHost.innerHTML = '<div class="empty">手记暂时没有加载成功。</div>';
  } else {
    journalHost.innerHTML = '<div class="empty">她还没有写下第一篇手记。</div>';
  }

  const galleryHost = $("#overviewRecentGallery");
  galleryHost.replaceChildren();
  galleryImages.slice(0, 3).forEach((image) => {
    const button = document.createElement("button");
    button.type = "button";
    const previewLabel = image.origin === "journal" ? "查看手记留影" : "查看对话留影";
    button.title = previewLabel;
    const preview = document.createElement("img");
    preview.src = image.source;
    preview.alt = previewLabel;
    preview.loading = "lazy";
    button.append(preview);
    button.addEventListener("click", () => openLightbox(image));
    galleryHost.append(button);
  });
  if (!galleryHost.children.length && galleryLoading) {
    galleryHost.innerHTML = '<div class="empty">最近画面正在赶来…</div>';
  } else if (!galleryHost.children.length && galleryLoadError) {
    galleryHost.innerHTML = '<div class="empty">最近画面暂时没有加载成功。</div>';
  } else if (!galleryHost.children.length) {
    galleryHost.innerHTML = '<div class="empty">她还没有画下新的画面。</div>';
  }

  const growthHost = $("#overviewLatestGrowth");
  growthHost.replaceChildren();
  const latestGrowth = personalityEvents[0];
  if (latestGrowth) {
    const title = document.createElement("strong");
    title.textContent = window.XuanGrowthLanguage.growthTitle(latestGrowth);
    const content = document.createElement("p");
    content.textContent = window.XuanGrowthLanguage.growthNarration(
      latestGrowth,
      profile?.name || "小玄",
      "洛尼"
    );
    const meta = document.createElement("small");
    meta.textContent = latestGrowth.status === "candidate" ? "等待确认" : "已经成为她的一部分";
    growthHost.append(title, content, meta);
  } else if (assistantContentState.growth.loading) {
    growthHost.innerHTML = '<div class="empty">成长记录正在整理…</div>';
  } else if (assistantContentState.growth.error) {
    growthHost.innerHTML = '<div class="empty">成长记录暂时没有加载成功。</div>';
  } else {
    growthHost.innerHTML = '<div class="empty">相处还在继续，变化会慢慢留在这里。</div>';
  }
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
  const previous = $("#journalPrevious");
  const next = $("#journalNext");
  list.replaceChildren();
  const snapshot = journalPager.setItems(journals);
  previous.disabled = !snapshot.hasPrevious;
  next.disabled = !snapshot.hasNext;
  $("#journalPageLabel").textContent = snapshot.total
    ? `${snapshot.index + 1} / ${snapshot.total}`
    : "0 / 0";

  const journal = snapshot.item;
  if (!journal) {
    const emptyPage = document.createElement("article");
    emptyPage.className = "journal-page journal-page-empty";
    const message = assistantContentState.journals.loading
      ? "手记正在慢慢翻开…"
      : assistantContentState.journals.error
        ? "手记暂时没有加载成功，请稍后重试。"
        : "还没有手记。完成一个自然日或完整一周后，她会自己写下来。";
    emptyPage.innerHTML = `<div class="empty">${message}</div>`;
    list.append(emptyPage);
    return;
  }

  const page = document.createElement("article");
  page.className = ["journal-page", journalTurnDirection].filter(Boolean).join(" ");
  const header = document.createElement("header");
  const heading = document.createElement("div");
  heading.className = "journal-page-heading";
  const eyebrow = document.createElement("span");
  eyebrow.textContent = journal.type === "daily" ? "DIARY" : "WEEKLY NOTE";
  const title = document.createElement("h3");
  title.textContent = journal.title;
  heading.append(eyebrow, title);

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
  header.append(heading, controls);

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
  page.append(header, content, meta);
  list.append(page);
  journalTurnDirection = "";
}

function turnJournalPage(offset) {
  const before = journalPager.snapshot();
  const after = journalPager.move(offset);
  if (before.index === after.index) return;
  journalTurnDirection = offset > 0 ? "turning-forward" : "turning-backward";
  renderJournals();
}

function renderGallery() {
  const grid = $("#galleryGrid");
  grid.replaceChildren();
  const visible = galleryImages.filter(
    (image) => galleryFilter === "all" || image.origin === galleryFilter
  );
  if (!visible.length) {
    const message = galleryLoading
      ? "正在翻开相册…"
      : galleryLoadError
        ? "这一页暂时没有加载成功，请重试。"
        : galleryImages.length
          ? "当前已加载的画面里还没有这一类。"
          : "相册还是空的。当她在对话或手记里画下画面时，会收进这里。";
    grid.innerHTML = `<div class="empty">${message}</div>`;
    renderGalleryPagination();
    return;
  }

  window.XuanGalleryLayout.groupGalleryByMonth(visible).forEach((group) => {
    const section = document.createElement("section");
    section.className = "gallery-month";
    const heading = document.createElement("header");
    heading.className = "gallery-month-heading";
    const title = document.createElement("h3");
    title.textContent = group.label;
    const count = document.createElement("span");
    count.textContent = `${group.items.length} 张留影`;
    heading.append(title, count);

    const photos = document.createElement("div");
    photos.className = "gallery-month-grid";
    group.items.forEach((image, index) => {
      const originLabel = image.origin === "journal" ? "手记" : "对话";
      const figure = document.createElement("figure");
      figure.className = `gallery-item gallery-tilt-${index % 4}`;
      figure.tabIndex = 0;
      figure.setAttribute("role", "button");
      figure.setAttribute("aria-label", `查看${originLabel}留影`);

      const photo = document.createElement("div");
      photo.className = "gallery-photo";
      const img = document.createElement("img");
      img.src = image.source;
      img.alt = `${originLabel}留影`;
      img.loading = "lazy";
      const badge = document.createElement("span");
      badge.className = `gallery-badge gallery-badge-${image.origin}`;
      badge.textContent = image.origin === "journal" ? "手记" : "对话";
      photo.append(img, badge);

      const caption = document.createElement("figcaption");
      const time = document.createElement("time");
      time.textContent = window.XuanGalleryLayout.formatGalleryDate(image.createdAt);
      const recordedAt = new Date(image.createdAt);
      if (!Number.isNaN(recordedAt.getTime())) time.dateTime = recordedAt.toISOString();
      caption.append(time);
      figure.append(photo, caption);

      const open = () => openLightbox(image);
      figure.addEventListener("click", open);
      figure.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        open();
      });
      photos.append(figure);
    });
    section.append(heading, photos);
    grid.append(section);
  });
  renderGalleryPagination();
}

function renderGalleryPagination() {
  const status = $("#galleryPageStatus");
  const more = $("#galleryLoadMore");
  if (galleryLoading) {
    status.textContent = galleryImages.length
      ? `已翻开 ${galleryImages.length} 张，下一页正在赶来…`
      : "画面正在赶来…";
  } else if (galleryLoadError) {
    status.textContent = "这一页暂时没翻开。";
  } else if (!galleryTotal) {
    status.textContent = "";
  } else if (galleryHasMore) {
    status.textContent = `已翻开 ${galleryImages.length} / ${galleryTotal} 张`;
  } else {
    status.textContent = `共 ${galleryTotal} 张，已经翻到最后一页`;
  }
  more.disabled = galleryLoading;
  more.textContent = galleryLoadError ? "重新加载" : "继续翻阅";
  more.classList.toggle(
    "hidden",
    !galleryLoadError && (!galleryHasMore || galleryLoading)
  );
}

function openLightbox(image) {
  const lightbox = $("#galleryLightbox");
  const img = $("#galleryLightboxImage");
  const caption = $("#galleryLightboxCaption");
  img.src = image.source;
  img.alt = image.origin === "journal" ? "手记里的留影" : "对话里的留影";
  const originLabel = image.origin === "journal" ? "手记" : "对话";
  const recordedAt = window.XuanGalleryLayout.formatGalleryDate(image.createdAt);
  caption.textContent = `${recordedAt} · 来自${originLabel}`;
  lightbox.classList.remove("hidden");
}

function closeLightbox() {
  $("#galleryLightbox").classList.add("hidden");
}

function renderPersonalityTimeline() {
  const timeline = $("#personalityTimeline");
  timeline.replaceChildren();
  personalityEvents.forEach((event, index) => {
    const card = document.createElement("article");
    card.className = `timeline-card timeline-tone-${index % 3}`;
    const date = new Date(event.createdAt);
    const dateLabel = Number.isNaN(date.getTime())
      ? "未记录"
      : date.toLocaleDateString("zh-CN", { month: "2-digit", day: "2-digit" });
    const yearLabel = Number.isNaN(date.getTime()) ? "" : String(date.getFullYear());
    const time = document.createElement("time");
    const dateMain = document.createElement("strong");
    dateMain.textContent = dateLabel;
    const dateYear = document.createElement("span");
    dateYear.textContent = yearLabel;
    time.append(dateMain, dateYear);
    const dot = document.createElement("i");
    dot.className = "timeline-dot";
    const copy = document.createElement("div");
    copy.className = "timeline-copy";
    const heading = document.createElement("header");
    const title = document.createElement("strong");
    title.textContent = window.XuanGrowthLanguage.growthTitle(event);
    const status = document.createElement("span");
    status.className = `growth-status ${event.status === "candidate" ? "pending" : "active"}`;
    status.textContent = event.status === "candidate" ? "待确认" : "已成为一部分";
    heading.append(title, status);
    const content = document.createElement("p");
    content.textContent = window.XuanGrowthLanguage.growthNarration(
      event,
      profile?.name || "小玄",
      "洛尼"
    );
    copy.append(heading, content);
    card.append(time, dot, copy);
    timeline.append(card);
  });
  if (!personalityEvents.length) {
    const message = assistantContentState.growth.loading
      ? "成长记录正在整理…"
      : assistantContentState.growth.error
        ? "成长记录暂时没有加载成功，请稍后重试。"
        : "还没有人格成长记录。";
    timeline.innerHTML = `<div class="empty">${message}</div>`;
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

function refreshGrowthViews() {
  $("#growthEventCount").textContent = assistantContentState.growth.loading
    ? "…"
    : String(personalityEvents.length);
  renderPersonalityTimeline();
  renderAssistantOverview();
}

function refreshJournalViews() {
  renderJournals();
  renderAssistantOverview();
}

function refreshGalleryViews() {
  renderGallery();
  renderAssistantOverview();
}

async function loadGrowthContent() {
  assistantContentState.growth.loading = true;
  assistantContentState.growth.error = "";
  refreshGrowthViews();
  try {
    personalityEvents = await window.desktop.listPersonalityEvents();
  } catch (error) {
    assistantContentState.growth.error = error.message;
    throw error;
  } finally {
    assistantContentState.growth.loading = false;
    refreshGrowthViews();
  }
}

async function loadJournalContent() {
  assistantContentState.journals.loading = true;
  assistantContentState.journals.error = "";
  refreshJournalViews();
  try {
    journals = await window.desktop.listJournals({ limit: 50 });
  } catch (error) {
    assistantContentState.journals.error = error.message;
    throw error;
  } finally {
    assistantContentState.journals.loading = false;
    refreshJournalViews();
  }
}

async function loadGallerySummary() {
  if (galleryLoadPromise) return galleryLoadPromise;
  galleryLoading = true;
  galleryLoadError = "";
  refreshGalleryViews();
  galleryLoadPromise = (async () => {
    try {
      const summary = await window.desktop.getAssistantGallerySummary({
        limit: GALLERY_OVERVIEW_LIMIT
      });
      galleryImages = Array.isArray(summary?.items) ? summary.items : [];
      galleryTotal = Math.max(0, Number(summary?.total) || 0);
      galleryHasMore = galleryImages.length < galleryTotal;
    } catch (error) {
      galleryImages = [];
      galleryTotal = 0;
      galleryHasMore = false;
      galleryLoadError = error.message;
      throw error;
    } finally {
      galleryLoading = false;
      galleryLoadPromise = null;
      refreshGalleryViews();
    }
  })();
  return galleryLoadPromise;
}

async function loadMoreGallery() {
  if (galleryLoadPromise) return galleryLoadPromise;
  if (!galleryHasMore && galleryImages.length) return;
  galleryLoading = true;
  galleryLoadError = "";
  refreshGalleryViews();
  galleryLoadPromise = (async () => {
    try {
      const page = await window.desktop.getAssistantGalleryPage({
        offset: galleryImages.length,
        limit: GALLERY_PAGE_SIZE
      });
      const knownIds = new Set(galleryImages.map((image) => image.id));
      const nextItems = (Array.isArray(page?.items) ? page.items : []).filter(
        (image) => !knownIds.has(image.id)
      );
      galleryImages = [...galleryImages, ...nextItems];
      galleryTotal = Math.max(galleryImages.length, Number(page?.total) || 0);
      galleryHasMore = Boolean(page?.hasMore);
    } catch (error) {
      galleryLoadError = error.message;
      throw error;
    } finally {
      galleryLoading = false;
      galleryLoadPromise = null;
      refreshGalleryViews();
    }
  })();
  return galleryLoadPromise;
}

function showGalleryLoadFailure(error) {
  showNotice(`相册暂时没有加载成功：${error.message}`, true);
}

async function loadAssistantContent() {
  const results = await Promise.allSettled([
    loadGrowthContent(),
    loadJournalContent(),
    loadGallerySummary()
  ]);
  const failed = results.filter((result) => result.status === "rejected");
  if (failed.length) {
    showNotice("部分内容暂时没有加载成功，可以稍后重试。", true);
  }
  if (assistantView === "gallery" && galleryHasMore) {
    void loadMoreGallery().catch(showGalleryLoadFailure);
  }
}

async function loadProfile() {
  if (kind === "user") {
    profile = await window.desktop.getProfile();
  } else {
    profile = await window.desktop.getAssistantProfile();
  }
  render();
  if (kind === "assistant") await loadAssistantContent();
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

function openAssistantSettings() {
  if (kind !== "assistant") return;
  $("#assistantSettingsModal").classList.remove("hidden");
  $("#assistantName").focus();
}

function closeAssistantSettings() {
  $("#assistantSettingsModal").classList.add("hidden");
}

$("#chooseAvatar").addEventListener("click", () => $("#avatarFile").click());
$("#chooseAssistantAvatar").addEventListener("click", () => $("#avatarFile").click());
$("#avatarButton").addEventListener("click", () => {
  if (kind === "assistant") openAssistantSettings();
  else $("#avatarFile").click();
});
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
    journalPager.setFilter(button.dataset.journalType);
    journalTurnDirection = "";
    document.querySelectorAll(".journal-tab").forEach((item) =>
      item.classList.toggle("active", item === button)
    );
    renderJournals();
  });
});

$("#journalPrevious").addEventListener("click", () => turnJournalPage(-1));
$("#journalNext").addEventListener("click", () => turnJournalPage(1));

document.querySelectorAll(".gallery-tab").forEach((button) => {
  button.addEventListener("click", () => {
    galleryFilter = button.dataset.galleryOrigin;
    document.querySelectorAll(".gallery-tab").forEach((item) =>
      item.classList.toggle("active", item === button)
    );
    renderGallery();
  });
});
$("#galleryLoadMore").addEventListener("click", () => {
  const request = galleryLoadError && !galleryImages.length
    ? loadGallerySummary()
    : loadMoreGallery();
  void request.catch(showGalleryLoadFailure);
});
$("#removeAssistantAvatar").addEventListener("click", async () => {
  try {
    await saveAvatar("");
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.querySelectorAll("[data-profile-view]").forEach((button) => {
  button.addEventListener("click", () => setAssistantView(button.dataset.profileView));
});

document.querySelectorAll("[data-open-profile-view]").forEach((button) => {
  button.addEventListener("click", () =>
    setAssistantView(button.dataset.openProfileView)
  );
});

$("#editAssistantProfile").addEventListener("click", openAssistantSettings);
$("#closeAssistantSettings").addEventListener("click", closeAssistantSettings);
$("#assistantSettingsModal").addEventListener("click", (event) => {
  if (event.target === $("#assistantSettingsModal")) closeAssistantSettings();
});

$("#galleryLightbox").addEventListener("click", (event) => {
  if (event.target === $("#galleryLightbox") || event.target.closest("[data-gallery-close]")) {
    closeLightbox();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  closeLightbox();
  closeAssistantSettings();
});
document.addEventListener("keydown", (event) => {
  if (
    kind !== "assistant" ||
    assistantView !== "journal" ||
    !$("#assistantSettingsModal").classList.contains("hidden") ||
    !$("#galleryLightbox").classList.contains("hidden")
  ) return;
  if (event.key === "ArrowLeft") {
    event.preventDefault();
    turnJournalPage(-1);
  }
  if (event.key === "ArrowRight") {
    event.preventDefault();
    turnJournalPage(1);
  }
});

window.addEventListener("message", async (event) => {
  if (kind !== "assistant") return;
  const type = event.data?.type;
  if (type === "aether:journals-updated") {
    const results = await Promise.allSettled([
      loadJournalContent(),
      loadGallerySummary()
    ]);
    if (results.some((result) => result.status === "rejected")) {
      showNotice("更新后的部分内容暂时没有加载成功。", true);
    }
  } else if (type === "aether:gallery-updated") {
    try {
      await loadGallerySummary();
    } catch (error) {
      showGalleryLoadFailure(error);
    }
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
    closeAssistantSettings();
    showNotice("她的人设已经保存。");
  } catch (error) {
    showNotice(error.message, true);
  }
});

loadProfile().catch((error) => showNotice(error.message, true));
