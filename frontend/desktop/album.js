if (new URLSearchParams(window.location.search).has("embedded")) {
  document.body.classList.add("embedded");
  if (!window.desktop && window.parent?.desktop) {
    window.desktop = window.parent.desktop;
  }
}

const state = {
  moments: [],
  query: "",
  loading: true,
  error: "",
  turnDirection: ""
};
const pager = new window.AetherAlbumPager();
const $ = (selector) => document.querySelector(selector);

function navigate(target, fallback) {
  if (document.body.classList.contains("embedded")) {
    window.parent.postMessage({ type: "xuan:navigate", target }, "*");
  } else {
    window.location.href = fallback;
  }
}

function showNotice(message, error = false) {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice${error ? " error" : ""}`;
  clearTimeout(showNotice.timer);
  showNotice.timer = setTimeout(() => notice.classList.add("hidden"), 2800);
}

async function loadMoments(options = {}) {
  state.loading = true;
  state.error = "";
  render();
  try {
    const moments = await window.desktop.listAlbumMoments({
      q: state.query,
      status: "all",
      limit: 80
    });
    state.moments = Array.isArray(moments) ? moments : [];
    pager.setItems(state.moments, {
      preserveCurrent: Boolean(options.preserveCurrent)
    });
  } catch (error) {
    state.error = error.message || "纪念册读取失败。";
    if (!options.silent) showNotice(state.error, true);
  } finally {
    state.loading = false;
    render();
  }
}

function render() {
  renderIndex();
  const snapshot = pager.snapshot();
  const timeline = $("#albumTimeline");
  timeline.replaceChildren();

  $("#albumPrevious").disabled = state.loading || !snapshot.hasPrevious;
  $("#albumNext").disabled = state.loading || !snapshot.hasNext;
  $("#albumPageLabel").textContent = snapshot.total
    ? `${snapshot.index + 1} / ${snapshot.total}`
    : "0 / 0";

  if (state.loading && !state.moments.length) {
    timeline.append(createEmptyPage("纪念册正在慢慢翻开…", "LOADING OUR STORY"));
    return;
  }
  if (state.error && !state.moments.length) {
    timeline.append(createEmptyPage("这一页暂时没有翻开，再试一次吧。", "PAGE UNAVAILABLE"));
    return;
  }
  if (!snapshot.item) {
    timeline.append(
      createEmptyPage(
        state.query
          ? "没有找到相关纪念，换一个词再翻翻看吧。"
          : "还没有纪念页。你可以让小玄把重要时刻收进来。",
        state.query ? "NOT FOUND" : "OUR FIRST PAGE"
      )
    );
    return;
  }

  timeline.append(createMomentSpread(snapshot.item, snapshot.index));
  state.turnDirection = "";
}

function renderIndex() {
  $("#momentCount").textContent = state.loading && !state.moments.length
    ? "…"
    : String(state.moments.length);
  $("#sourceCount").textContent = state.loading && !state.moments.length
    ? "…"
    : String(
        state.moments.reduce(
          (sum, moment) => sum + (moment.sources?.length || 0),
          0
        )
      );
  $("#latestMoment").textContent = state.moments[0]
    ? formatShortDate(state.moments[0].occurredAt)
    : "还没有";
}

function createMomentSpread(moment, index) {
  const spread = document.createElement("article");
  spread.className = ["moment-card", state.turnDirection]
    .filter(Boolean)
    .join(" ");

  const date = dateParts(moment.occurredAt);
  const left = document.createElement("section");
  left.className = "moment-page moment-page-left";
  const right = document.createElement("section");
  right.className = "moment-page moment-page-right";

  const leafLabel = document.createElement("div");
  leafLabel.className = "moment-leaf-label";
  leafLabel.textContent = `MEMORY · ${String(index + 1).padStart(2, "0")}`;

  const dateCard = document.createElement("div");
  dateCard.className = "moment-date";
  const day = document.createElement("strong");
  day.textContent = date.day;
  const monthYear = document.createElement("div");
  const month = document.createElement("span");
  month.textContent = date.month;
  const year = document.createElement("small");
  year.textContent = date.year;
  monthYear.append(month, year);
  dateCard.append(day, monthYear);

  const keepsake = document.createElement("div");
  keepsake.className = "moment-keepsake";
  const tape = document.createElement("i");
  tape.className = "moment-tape";
  tape.setAttribute("aria-hidden", "true");
  const symbol = document.createElement("span");
  symbol.className = "moment-keepsake-symbol";
  symbol.textContent = "✦";
  const keepsakeLabel = document.createElement("small");
  keepsakeLabel.textContent = moment.mood || "值得珍藏";
  const summary = document.createElement("blockquote");
  summary.textContent = moment.summary;
  keepsake.append(tape, symbol, keepsakeLabel, summary);

  const tags = document.createElement("div");
  tags.className = "moment-meta";
  (moment.tags || []).slice(0, 6).forEach((tag) => tags.append(pill(tag)));

  const leftNote = document.createElement("p");
  leftNote.className = "moment-left-note";
  leftNote.textContent = "把这一天轻轻贴好，留给以后的我们。";
  left.append(leafLabel, dateCard, keepsake, tags, leftNote);

  const heading = document.createElement("header");
  heading.className = "moment-head";
  const eyebrow = document.createElement("span");
  eyebrow.className = "moment-eyebrow";
  eyebrow.textContent = moment.mood
    ? `那一刻，我的心情是 ${moment.mood}`
    : "写给我们的时刻";
  const title = document.createElement("h2");
  title.textContent = moment.title;
  const time = document.createElement("time");
  time.dateTime = new Date(moment.occurredAt).toISOString();
  time.textContent = formatDate(moment.occurredAt);
  heading.append(eyebrow, title, time);

  const detail = document.createElement("p");
  detail.className = "moment-detail";
  detail.textContent = moment.detail || moment.summary;

  const sourceSection = document.createElement("section");
  sourceSection.className = "moment-sources";
  const sourceButton = document.createElement("button");
  sourceButton.className = "moment-source-toggle";
  sourceButton.type = "button";
  sourceButton.setAttribute("aria-expanded", "false");
  sourceButton.innerHTML = `<span>翻开这一页的来处</span><small>${
    moment.sources?.length || 0
  } 份</small><i aria-hidden="true"></i>`;

  const sourceList = document.createElement("div");
  sourceList.className = "source-list hidden";
  (moment.sources || []).forEach((source) =>
    sourceList.append(createSourceItem(source))
  );
  if (!moment.sources?.length) {
    const empty = document.createElement("div");
    empty.className = "source-item";
    empty.textContent = "这页暂时没有绑定来源，但故事已经被好好收下。";
    sourceList.append(empty);
  }
  sourceButton.addEventListener("click", () => {
    const expanded = sourceButton.getAttribute("aria-expanded") === "true";
    sourceButton.setAttribute("aria-expanded", String(!expanded));
    sourceList.classList.toggle("hidden", expanded);
  });
  sourceSection.append(sourceButton, sourceList);

  const signature = document.createElement("footer");
  signature.className = "moment-signature";
  signature.innerHTML = `<span>收录于我们的纪念册</span><i></i><small>NO. ${String(
    index + 1
  ).padStart(2, "0")}</small>`;
  right.append(heading, detail, sourceSection, signature);

  spread.append(left, right);
  return spread;
}

function createEmptyPage(message, eyebrow) {
  const empty = document.createElement("article");
  empty.className = "moment-card moment-card-empty";
  const page = document.createElement("section");
  page.className = "moment-page moment-empty-page";
  const mark = document.createElement("span");
  mark.textContent = "◇";
  const label = document.createElement("small");
  label.textContent = eyebrow;
  const copy = document.createElement("p");
  copy.textContent = message;
  page.append(mark, label, copy);
  empty.append(page);
  return empty;
}

function createSourceItem(source) {
  const item = document.createElement("div");
  item.className = "source-item";
  const label = document.createElement("strong");
  label.textContent = sourceLabel(source.sourceType);
  const excerpt = document.createElement("span");
  excerpt.textContent = source.sourceExcerpt || source.sourceId;
  item.append(label, excerpt);
  return item;
}

function pill(text) {
  const item = document.createElement("span");
  item.textContent = text;
  return item;
}

function sourceLabel(type) {
  return {
    shared_memory: "共同记忆",
    journal: "小玄手记",
    mood_event: "心情事件",
    conversation_message: "聊天片段",
    memory: "长期记忆",
    manual: "手动收录"
  }[type] || type;
}

function formatDate(value) {
  if (!value) return "时间被轻轻藏起来了";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(value);
}

function formatShortDate(value) {
  if (!value) return "还没有";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "short",
    day: "numeric"
  }).format(value);
}

function dateParts(value) {
  if (!value) return { year: "----", month: "--", day: "--" };
  const date = new Date(value);
  return {
    year: String(date.getFullYear()),
    month: `${date.getMonth() + 1}月`,
    day: String(date.getDate()).padStart(2, "0")
  };
}

function turnPage(offset) {
  const before = pager.snapshot();
  const after = pager.move(offset);
  if (before.index === after.index) return;
  state.turnDirection = offset > 0 ? "turning-forward" : "turning-backward";
  render();
}

$("#albumSearch").addEventListener("input", (event) => {
  state.query = event.currentTarget.value.trim();
  clearTimeout(loadMoments.timer);
  loadMoments.timer = setTimeout(() => loadMoments(), 220);
});
$("#refreshAlbumBtn").addEventListener("click", () =>
  loadMoments({ preserveCurrent: true })
);
$("#albumPrevious").addEventListener("click", () => turnPage(-1));
$("#albumNext").addEventListener("click", () => turnPage(1));
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
    return;
  }
  if (event.key === "ArrowLeft") turnPage(-1);
  if (event.key === "ArrowRight") turnPage(1);
});
$("#homeBtn").addEventListener("click", () => navigate("chat", "home.html"));
$("#todoBtn").addEventListener("click", () => navigate("todo", "index.html"));
$("#memoryBtn").addEventListener("click", () => navigate("memory", "memory.html"));
$("#modulesBtn").addEventListener("click", () => navigate("modules", "modules.html"));
$("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
$("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
$("#closeBtn").addEventListener("click", () => window.desktop.close());

loadMoments();
