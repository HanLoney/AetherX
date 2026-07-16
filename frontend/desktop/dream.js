if (new URLSearchParams(window.location.search).has("embedded")) {
  document.body.classList.add("embedded");
  if (!window.desktop && window.parent?.desktop) {
    window.desktop = window.parent.desktop;
  }
}

const state = {
  dreams: [],
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

async function loadDreams() {
  state.dreams = await window.desktop.listDreams({
    q: state.query,
    status: "all",
    limit: 80
  });
  render();
}

function render() {
  $("#dreamCount").textContent = String(state.dreams.length);
  $("#symbolCount").textContent = String(
    new Set(state.dreams.flatMap((dream) => dream.symbols || [])).size
  );
  $("#latestDream").textContent = state.dreams[0]
    ? state.dreams[0].dreamDate
    : "还没有";

  const list = $("#dreamList");
  list.replaceChildren();
  if (!state.dreams.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = state.query
      ? "没有找到相关梦境。"
      : "还没有梦。开启模块后，小玄会在合适的时候把梦写下来。";
    list.append(empty);
    return;
  }

  state.dreams.forEach((dream) => list.append(createDreamCard(dream)));
}

function createDreamCard(dream) {
  const card = document.createElement("article");
  card.className = "dream-card";

  const header = document.createElement("header");
  const titleBox = document.createElement("div");
  const eyebrow = document.createElement("span");
  eyebrow.className = "dream-eyebrow";
  eyebrow.textContent = dream.mood || "醒来后还有一点余光";
  const title = document.createElement("h2");
  title.textContent = dream.title;
  const date = document.createElement("div");
  date.className = "dream-date";
  date.textContent = dream.dreamDate;
  titleBox.append(eyebrow, title, date);

  const sourceButton = document.createElement("button");
  sourceButton.className = "dream-source-toggle";
  sourceButton.type = "button";
  sourceButton.textContent = `灵感 ${dream.sources?.length || 0}`;
  header.append(titleBox, sourceButton);

  const content = document.createElement("p");
  content.className = "dream-content";
  content.textContent = dream.content;

  const note = document.createElement("p");
  note.className = "dream-note";
  note.textContent = dream.realityNote || "这是虚构梦境，不代表现实发生。";

  const symbols = document.createElement("div");
  symbols.className = "dream-symbols";
  (dream.symbols || []).forEach((symbol) => {
    const item = document.createElement("span");
    item.textContent = symbol;
    symbols.append(item);
  });

  const sources = document.createElement("div");
  sources.className = "dream-sources hidden";
  (dream.sources || []).forEach((source) => sources.append(createSourceItem(source)));
  if (!dream.sources?.length) {
    const empty = document.createElement("div");
    empty.className = "dream-source";
    empty.textContent = "这段梦暂时没有绑定灵感来源。";
    sources.append(empty);
  }

  sourceButton.addEventListener("click", () => {
    sources.classList.toggle("hidden");
  });

  card.append(header, content, note);
  if (symbols.children.length) card.append(symbols);
  card.append(sources);
  return card;
}

function createSourceItem(source) {
  const item = document.createElement("div");
  item.className = "dream-source";
  const label = document.createElement("strong");
  label.textContent = `${sourceLabel(source.sourceType)} · 灵感来源`;
  const excerpt = document.createElement("span");
  excerpt.textContent = source.sourceExcerpt || source.sourceId;
  item.append(label, excerpt);
  return item;
}

function sourceLabel(type) {
  return {
    chat: "聊天",
    journal: "手记",
    memory: "长期记忆",
    shared_memory: "共同记忆",
    mood_event: "心情"
  }[type] || "素材";
}

$("#dreamSearch").addEventListener("input", (event) => {
  state.query = event.currentTarget.value.trim();
  clearTimeout(loadDreams.timer);
  loadDreams.timer = setTimeout(loadDreams, 180);
});
$("#refreshDreamBtn").addEventListener("click", loadDreams);
$("#homeBtn").addEventListener("click", () => navigate("chat", "home.html"));
$("#todoBtn").addEventListener("click", () => navigate("todo", "index.html"));
$("#memoryBtn").addEventListener("click", () => navigate("memory", "memory.html"));
$("#albumBtn").addEventListener("click", () => navigate("album", "album.html"));
$("#modulesBtn").addEventListener("click", () => navigate("modules", "modules.html"));
$("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
$("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
$("#closeBtn").addEventListener("click", () => window.desktop.close());

window.addEventListener("message", (event) => {
  if (event.data?.type === "aether:dreams-updated") {
    loadDreams();
    return;
  }
  if (event.data?.type !== "aether:sync-changes") return;
  const relevant = new Set(["assistant_dreams", "assistant_dream_sources"]);
  if (!(event.data.changes || []).some((change) => relevant.has(change.entityType))) return;
  clearTimeout(loadDreams.syncTimer);
  loadDreams.syncTimer = setTimeout(
    () => loadDreams().catch((error) => showNotice(error.message || "梦境读取失败。", true)),
    180
  );
});

loadDreams().catch((error) => showNotice(error.message || "梦境读取失败。", true));
