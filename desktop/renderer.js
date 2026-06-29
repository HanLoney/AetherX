const STORAGE_KEY = "xuan-todo-items-v1";
const APPEARANCE_KEY = "xuan-calendar-appearance-v1";
const BACKGROUND_DB = "xuan-calendar-assets";

const now = new Date();
const state = {
  todos: loadTodos(),
  selectedDate: startOfDay(now),
  visibleMonth: new Date(now.getFullYear(), now.getMonth(), 1),
  filter: "all",
  editingId: null
};

const calendarGrid = document.querySelector("#calendarGrid");
const monthTitle = document.querySelector("#monthTitle");
const list = document.querySelector("#todoList");
const template = document.querySelector("#todoTemplate");
const emptyState = document.querySelector("#emptyState");
const saveStatus = document.querySelector("#saveStatus");
const dialog = document.querySelector("#todoDialog");
const form = document.querySelector("#todoForm");
const todoInput = document.querySelector("#todoInput");
const startInput = document.querySelector("#startTimeInput");
const endInput = document.querySelector("#endTimeInput");
const formError = document.querySelector("#formError");
const deleteTodoBtn = document.querySelector("#deleteTodoBtn");
const clearCompleted = document.querySelector("#clearCompleted");
const appearanceDialog = document.querySelector("#appearanceDialog");
const backgroundFileInput = document.querySelector("#backgroundFileInput");
const backgroundPreview = document.querySelector("#backgroundPreview");
const customBackground = document.querySelector("#customBackground");
const backgroundDimInput = document.querySelector("#backgroundDimInput");
const backgroundBlurInput = document.querySelector("#backgroundBlurInput");
const headlineText = document.querySelector("#headlineText");
const headlineInput = document.querySelector("#headlineInput");

const DEFAULT_HEADLINE = "把每一天，安排得刚刚好。";

let backgroundObjectUrl = null;

function loadAppearance() {
  try {
    const saved = {
      theme: "blossom",
      dim: 22,
      blur: 0,
      headline: DEFAULT_HEADLINE,
      ...JSON.parse(localStorage.getItem(APPEARANCE_KEY))
    };
    if (!saved.glassBackgroundV2) {
      if (saved.dim === 62) saved.dim = 22;
      saved.glassBackgroundV2 = true;
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(saved));
    }
    return saved;
  } catch {
    return {
      theme: "blossom",
      dim: 22,
      blur: 0,
      headline: DEFAULT_HEADLINE,
      glassBackgroundV2: true
    };
  }
}

const appearance = loadAppearance();

function saveAppearance() {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
}

function openAssetDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(BACKGROUND_DB, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains("assets")) {
        request.result.createObjectStore("assets");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function setStoredBackground(blob) {
  const db = await openAssetDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("assets", "readwrite");
    transaction.objectStore("assets").put(blob, "background");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

async function getStoredBackground() {
  const db = await openAssetDb();
  const blob = await new Promise((resolve, reject) => {
    const request = db.transaction("assets", "readonly")
      .objectStore("assets").get("background");
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
  db.close();
  return blob;
}

async function removeStoredBackground() {
  const db = await openAssetDb();
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("assets", "readwrite");
    transaction.objectStore("assets").delete("background");
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
}

function showBackgroundBlob(blob) {
  if (backgroundObjectUrl) URL.revokeObjectURL(backgroundObjectUrl);
  if (!blob) {
    backgroundObjectUrl = null;
    customBackground.style.backgroundImage = "";
    backgroundPreview.style.backgroundImage = "";
    backgroundPreview.classList.remove("has-image");
    document.body.classList.remove("has-custom-background");
    return;
  }
  backgroundObjectUrl = URL.createObjectURL(blob);
  const image = `url("${backgroundObjectUrl}")`;
  customBackground.style.backgroundImage = image;
  backgroundPreview.style.backgroundImage = image;
  backgroundPreview.classList.add("has-image");
  document.body.classList.add("has-custom-background");
}

function applyAppearance() {
  document.body.dataset.theme = appearance.theme;
  document.documentElement.style.setProperty("--background-dim", appearance.dim / 100);
  document.documentElement.style.setProperty("--background-blur", `${appearance.blur}px`);
  backgroundDimInput.value = appearance.dim;
  backgroundBlurInput.value = appearance.blur;
  headlineText.textContent = appearance.headline || DEFAULT_HEADLINE;
  headlineInput.value = appearance.headline || DEFAULT_HEADLINE;
  document.querySelector("#backgroundDimValue").textContent = `${appearance.dim}%`;
  document.querySelector("#backgroundBlurValue").textContent = `${appearance.blur}px`;
  document.querySelectorAll(".theme-option").forEach(option => {
    option.classList.toggle("active", option.dataset.theme === appearance.theme);
  });
}

async function restoreBackground() {
  try {
    showBackgroundBlob(await getStoredBackground());
  } catch {
    showBackgroundBlob(null);
  }
}

function loadTodos() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!Array.isArray(saved)) return [];
    return saved.map(todo => {
      const fallbackStart = todo.createdAt || Date.now();
      return {
        ...todo,
        startAt: todo.startAt || fallbackStart,
        endAt: todo.endAt || fallbackStart + 60 * 60 * 1000
      };
    });
  } catch {
    return [];
  }
}

function persist() {
  saveStatus.classList.add("saving");
  saveStatus.lastChild.textContent = " 正在保存";
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.todos));
  window.setTimeout(() => {
    saveStatus.classList.remove("saving");
    saveStatus.lastChild.textContent = " 已实时保存到本机";
  }, 260);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toLocalInputValue(date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function formatTime(date) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function formatShortDate(date) {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function dayRelation(todo, date) {
  const start = new Date(todo.startAt);
  const end = new Date(todo.endAt);
  const isStart = sameDay(start, date);
  const isEnd = sameDay(end, date);
  const isRunning = start < startOfDay(date) && end > endOfDay(date);
  return { isStart, isEnd, isRunning };
}

function isRelated(todo, date) {
  return new Date(todo.startAt) <= endOfDay(date)
    && new Date(todo.endAt) >= startOfDay(date);
}

function eventsForDay(date) {
  return state.todos
    .filter(todo => isRelated(todo, date))
    .sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
}

function renderCalendar() {
  monthTitle.textContent = `${state.visibleMonth.getFullYear()}年 ${state.visibleMonth.getMonth() + 1}月`;
  calendarGrid.replaceChildren();

  const year = state.visibleMonth.getFullYear();
  const month = state.visibleMonth.getMonth();
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);

  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    const day = document.createElement("button");
    day.type = "button";
    day.className = "calendar-day";
    day.dataset.date = dateKey(date);
    day.setAttribute("aria-label", `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`);
    day.classList.toggle("other-month", date.getMonth() !== month);
    day.classList.toggle("today", sameDay(date, new Date()));
    day.classList.toggle("selected", sameDay(date, state.selectedDate));

    const number = document.createElement("span");
    number.className = "day-number";
    number.textContent = date.getDate();
    day.append(number);

    const eventBox = document.createElement("span");
    eventBox.className = "day-events";
    const events = eventsForDay(date);
    const markers = [];

    events.forEach(todo => {
      const relation = dayRelation(todo, date);
      if (relation.isStart) markers.push({ todo, type: "start", label: "始" });
      if (relation.isEnd) markers.push({ todo, type: "end", label: "止" });
      if (relation.isRunning) markers.push({ todo, type: "running", label: "续" });
    });

    markers.slice(0, 2).forEach(marker => {
      const row = document.createElement("span");
      row.className = `day-event ${marker.type}${marker.todo.completed ? " completed" : ""}`;
      const badge = document.createElement("b");
      badge.textContent = marker.label;
      const title = document.createElement("span");
      title.textContent = marker.todo.text;
      row.append(badge, title);
      eventBox.append(row);
    });

    if (markers.length > 2) {
      const more = document.createElement("span");
      more.className = "more-events";
      more.textContent = `还有 ${markers.length - 2} 条`;
      eventBox.append(more);
    }

    day.append(eventBox);
    day.addEventListener("click", () => {
      state.selectedDate = startOfDay(date);
      if (date.getMonth() !== state.visibleMonth.getMonth()
        || date.getFullYear() !== state.visibleMonth.getFullYear()) {
        state.visibleMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      }
      render();
    });
    calendarGrid.append(day);
  }
}

function getAgendaTodos() {
  const related = eventsForDay(state.selectedDate);
  if (state.filter === "active") return related.filter(todo => !todo.completed);
  if (state.filter === "completed") return related.filter(todo => todo.completed);
  return related;
}

function timeDescription(todo) {
  const start = new Date(todo.startAt);
  const end = new Date(todo.endAt);
  if (sameDay(start, end)) return `${formatTime(start)} — ${formatTime(end)}`;
  return `${formatShortDate(start)} ${formatTime(start)} — ${formatShortDate(end)} ${formatTime(end)}`;
}

function appendTag(container, text, type) {
  const tag = document.createElement("span");
  tag.className = `todo-tag ${type}`;
  tag.textContent = text;
  container.append(tag);
}

function renderAgenda() {
  const weekday = new Intl.DateTimeFormat("zh-CN", { weekday: "long" }).format(state.selectedDate);
  document.querySelector("#selectedWeekday").textContent = weekday;
  document.querySelector("#selectedDateTitle").textContent =
    `${state.selectedDate.getMonth() + 1}月${state.selectedDate.getDate()}日`;

  const related = eventsForDay(state.selectedDate);
  const completedCount = related.filter(todo => todo.completed).length;
  const percent = related.length ? Math.round(completedCount / related.length * 100) : 0;
  document.querySelector("#dayProgressValue").textContent = `${percent}%`;

  const visible = getAgendaTodos();
  list.replaceChildren();

  visible.forEach(todo => {
    const item = template.content.firstElementChild.cloneNode(true);
    const relation = dayRelation(todo, state.selectedDate);
    item.classList.toggle("completed", todo.completed);
    item.querySelector(".todo-title").textContent = todo.text;
    item.querySelector(".todo-time").textContent = timeDescription(todo);
    const tags = item.querySelector(".todo-tags");

    if (relation.isStart) appendTag(tags, "当天开始", "start");
    if (relation.isEnd) appendTag(tags, "当天截止", "end");
    if (relation.isRunning) appendTag(tags, "进行中", "running");
    if (!todo.completed && new Date(todo.endAt) < new Date()) appendTag(tags, "已逾期", "overdue");

    item.querySelector(".check-button").addEventListener("click", () => {
      todo.completed = !todo.completed;
      persist();
      render();
    });
    item.querySelector(".todo-main").addEventListener("click", () => openDialog(todo.id));
    item.querySelector(".edit-button").addEventListener("click", () => openDialog(todo.id));
    list.append(item);
  });

  emptyState.classList.toggle("hidden", visible.length > 0);
  clearCompleted.disabled = !state.todos.some(todo => todo.completed);
}

function render() {
  renderCalendar();
  renderAgenda();
}

function defaultTimes() {
  const selected = new Date(state.selectedDate);
  const current = new Date();
  if (sameDay(selected, current)) {
    selected.setHours(current.getHours() + 1, 0, 0, 0);
  } else {
    selected.setHours(9, 0, 0, 0);
  }
  const end = new Date(selected.getTime() + 60 * 60 * 1000);
  return { start: selected, end };
}

function openDialog(id = null) {
  state.editingId = id;
  formError.textContent = "";
  const todo = state.todos.find(item => item.id === id);

  if (todo) {
    document.querySelector("#dialogEyebrow").textContent = "编辑安排";
    document.querySelector("#dialogTitle").textContent = "修改待办";
    todoInput.value = todo.text;
    startInput.value = toLocalInputValue(new Date(todo.startAt));
    endInput.value = toLocalInputValue(new Date(todo.endAt));
    deleteTodoBtn.classList.remove("hidden");
  } else {
    const defaults = defaultTimes();
    document.querySelector("#dialogEyebrow").textContent = "新建安排";
    document.querySelector("#dialogTitle").textContent = "添加待办";
    todoInput.value = "";
    startInput.value = toLocalInputValue(defaults.start);
    endInput.value = toLocalInputValue(defaults.end);
    deleteTodoBtn.classList.add("hidden");
  }

  dialog.showModal();
  window.setTimeout(() => todoInput.focus(), 50);
}

function closeDialog() {
  state.editingId = null;
  dialog.close();
}

form.addEventListener("submit", event => {
  event.preventDefault();
  const text = todoInput.value.trim();
  const start = new Date(startInput.value);
  const end = new Date(endInput.value);

  if (!text) {
    formError.textContent = "请写下待办内容。";
    return;
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    formError.textContent = "请填写完整的开始和结束时间。";
    return;
  }
  if (end <= start) {
    formError.textContent = "结束时间需要晚于开始时间。";
    return;
  }

  const existing = state.todos.find(todo => todo.id === state.editingId);
  if (existing) {
    existing.text = text;
    existing.startAt = start.getTime();
    existing.endAt = end.getTime();
  } else {
    state.todos.push({
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      text,
      startAt: start.getTime(),
      endAt: end.getTime(),
      completed: false,
      createdAt: Date.now()
    });
  }

  state.selectedDate = startOfDay(start);
  state.visibleMonth = new Date(start.getFullYear(), start.getMonth(), 1);
  persist();
  closeDialog();
  render();
});

deleteTodoBtn.addEventListener("click", () => {
  if (!state.editingId) return;
  state.todos = state.todos.filter(todo => todo.id !== state.editingId);
  persist();
  closeDialog();
  render();
});

document.querySelector("#newTodoBtn").addEventListener("click", () => openDialog());
document.querySelector("#closeDialogBtn").addEventListener("click", closeDialog);
document.querySelector("#cancelDialogBtn").addEventListener("click", closeDialog);

document.querySelector("#prevMonthBtn").addEventListener("click", () => {
  state.visibleMonth = new Date(
    state.visibleMonth.getFullYear(),
    state.visibleMonth.getMonth() - 1,
    1
  );
  renderCalendar();
});

document.querySelector("#nextMonthBtn").addEventListener("click", () => {
  state.visibleMonth = new Date(
    state.visibleMonth.getFullYear(),
    state.visibleMonth.getMonth() + 1,
    1
  );
  renderCalendar();
});

document.querySelector("#todayBtn").addEventListener("click", () => {
  const today = new Date();
  state.selectedDate = startOfDay(today);
  state.visibleMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  render();
});

document.querySelectorAll(".filter").forEach(button => {
  button.addEventListener("click", () => {
    state.filter = button.dataset.filter;
    document.querySelectorAll(".filter").forEach(current => {
      current.classList.toggle("active", current === button);
    });
    renderAgenda();
  });
});

clearCompleted.addEventListener("click", () => {
  state.todos = state.todos.filter(todo => !todo.completed);
  persist();
  render();
});

dialog.addEventListener("click", event => {
  if (event.target === dialog) closeDialog();
});

document.querySelector("#appearanceBtn").addEventListener("click", () => {
  applyAppearance();
  appearanceDialog.showModal();
});

document.querySelector("#closeAppearanceBtn").addEventListener("click", () => {
  appearanceDialog.close();
});

appearanceDialog.addEventListener("click", event => {
  if (event.target === appearanceDialog) appearanceDialog.close();
});

document.querySelectorAll(".theme-option").forEach(option => {
  option.addEventListener("click", () => {
    appearance.theme = option.dataset.theme;
    applyAppearance();
    saveAppearance();
  });
});

headlineInput.addEventListener("input", () => {
  appearance.headline = headlineInput.value || DEFAULT_HEADLINE;
  headlineText.textContent = appearance.headline;
  saveAppearance();
});

headlineInput.addEventListener("keydown", event => {
  if (event.key === "Enter") event.preventDefault();
});

document.querySelector("#resetHeadlineBtn").addEventListener("click", () => {
  appearance.headline = DEFAULT_HEADLINE;
  headlineInput.value = DEFAULT_HEADLINE;
  headlineText.textContent = DEFAULT_HEADLINE;
  saveAppearance();
});

document.querySelector("#chooseBackgroundBtn").addEventListener("click", () => {
  backgroundFileInput.click();
});

backgroundFileInput.addEventListener("change", async () => {
  const file = backgroundFileInput.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) return;
  await setStoredBackground(file);
  showBackgroundBlob(file);
  backgroundFileInput.value = "";
});

document.querySelector("#removeBackgroundBtn").addEventListener("click", async () => {
  await removeStoredBackground();
  showBackgroundBlob(null);
});

backgroundDimInput.addEventListener("input", () => {
  appearance.dim = Number(backgroundDimInput.value);
  document.documentElement.style.setProperty("--background-dim", appearance.dim / 100);
  document.querySelector("#backgroundDimValue").textContent = `${appearance.dim}%`;
  saveAppearance();
});

backgroundBlurInput.addEventListener("input", () => {
  appearance.blur = Number(backgroundBlurInput.value);
  document.documentElement.style.setProperty("--background-blur", `${appearance.blur}px`);
  document.querySelector("#backgroundBlurValue").textContent = `${appearance.blur}px`;
  saveAppearance();
});

document.querySelector("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
document.querySelector("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
document.querySelector("#closeBtn").addEventListener("click", () => window.desktop.close());

document.querySelector("#todayText").textContent = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long"
}).format(new Date());

applyAppearance();
restoreBackground();
render();
