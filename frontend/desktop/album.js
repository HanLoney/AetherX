if (new URLSearchParams(window.location.search).has("embedded")) {
  document.body.classList.add("embedded");
  if (!window.desktop && window.parent?.desktop) {
    window.desktop = window.parent.desktop;
  }
}

const state = {
  moments: [],
  query: ""
};

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

async function loadMoments() {
  state.moments = await window.desktop.listAlbumMoments({
    q: state.query,
    status: "all",
    limit: 80
  });
  render();
}

function render() {
  $("#momentCount").textContent = String(state.moments.length);
  $("#sourceCount").textContent = String(
    state.moments.reduce((sum, moment) => sum + (moment.sources?.length || 0), 0)
  );
  $("#latestMoment").textContent = state.moments[0]
    ? formatDate(state.moments[0].occurredAt)
    : "还没有";

  const timeline = $("#albumTimeline");
  timeline.replaceChildren();
  if (!state.moments.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.query
      ? "没有找到相关纪念卡。"
      : "还没有纪念卡。你可以让小玄把重要时刻写进我们的纪念册。";
    timeline.append(empty);
    return;
  }

  state.moments.forEach((moment) => timeline.append(createMomentCard(moment)));
}

function createMomentCard(moment) {
  const card = document.createElement("article");
  card.className = "moment-card";

  const date = dateParts(moment.occurredAt);
  const rail = document.createElement("aside");
  rail.className = "moment-date";
  const day = document.createElement("strong");
  day.textContent = date.day;
  const month = document.createElement("span");
  month.textContent = date.month;
  const year = document.createElement("small");
  year.textContent = date.year;
  rail.append(day, month, year);

  const body = document.createElement("section");
  body.className = "moment-page";

  const head = document.createElement("header");
  head.className = "moment-head";
  const titleBox = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "moment-eyebrow";
  eyebrow.textContent = moment.mood ? `心情：${moment.mood}` : "写给我们的时刻";
  const title = document.createElement("h2");
  title.textContent = moment.title;
  const time = document.createElement("div");
  time.className = "moment-time";
  time.textContent = formatDate(moment.occurredAt);
  titleBox.append(eyebrow, title, time);

  const actions = document.createElement("div");
  actions.className = "moment-actions";
  const sourceButton = document.createElement("button");
  sourceButton.type = "button";
  sourceButton.textContent = `来源 ${moment.sources?.length || 0}`;
  actions.append(sourceButton);
  head.append(titleBox, actions);

  const summary = document.createElement("p");
  summary.className = "moment-summary";
  summary.textContent = moment.summary;

  const detail = document.createElement("p");
  detail.className = "moment-detail";
  detail.textContent = moment.detail || "";
  detail.classList.toggle("hidden", !moment.detail);

  const meta = document.createElement("div");
  meta.className = "moment-meta";
  (moment.tags || []).forEach((tag) => meta.append(pill(tag)));

  const sourceList = document.createElement("div");
  sourceList.className = "source-list hidden";
  (moment.sources || []).forEach((source) =>
    sourceList.append(createSourceItem(source))
  );
  if (!moment.sources?.length) {
    const empty = document.createElement("div");
    empty.className = "source-item";
    empty.textContent = "这张纪念卡暂时没有绑定来源。";
    sourceList.append(empty);
  }

  sourceButton.addEventListener("click", () => {
    sourceList.classList.toggle("hidden");
  });

  body.append(head, summary, detail, meta, sourceList);
  card.append(rail, body);
  return card;
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
    conversation_message: "聊天证据",
    memory: "长期记忆",
    manual: "手动来源"
  }[type] || type;
}

function formatDate(value) {
  if (!value) return "未知时间";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
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

$("#albumSearch").addEventListener("input", (event) => {
  state.query = event.currentTarget.value.trim();
  clearTimeout(loadMoments.timer);
  loadMoments.timer = setTimeout(loadMoments, 180);
});
$("#refreshAlbumBtn").addEventListener("click", loadMoments);
$("#homeBtn").addEventListener("click", () => navigate("chat", "home.html"));
$("#todoBtn").addEventListener("click", () => navigate("todo", "index.html"));
$("#memoryBtn").addEventListener("click", () => navigate("memory", "memory.html"));
$("#modulesBtn").addEventListener("click", () => navigate("modules", "modules.html"));
$("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
$("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
$("#closeBtn").addEventListener("click", () => window.desktop.close());

loadMoments().catch((error) => showNotice(error.message || "纪念册读取失败。", true));
