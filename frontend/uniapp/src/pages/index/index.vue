<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { onShow } from "@dcloudio/uni-app";
import { useTodoStore } from "@/composables/useTodoStore";
import type {
  Appearance,
  ThemeName,
  TodoFilter,
  TodoItem
} from "@/types/todo";
import {
  dateKey,
  endOfDay,
  formatLongToday,
  formatShortDate,
  formatTime,
  formatWeekday,
  parseDateTime,
  sameDay,
  startOfDay,
  timeKey
} from "@/utils/date";

const APPEARANCE_KEY = "xuan-calendar-appearance-v1";
const DEFAULT_HEADLINE = "把每一天，安排得刚刚好。";
const weekdays = ["一", "二", "三", "四", "五", "六", "日"];
const filterOptions: Array<{ value: TodoFilter; label: string }> = [
  { value: "all", label: "当天相关" },
  { value: "active", label: "待完成" },
  { value: "completed", label: "已完成" }
];
const themes: Array<{
  value: ThemeName;
  label: string;
  colors: string;
}> = [
  { value: "blossom", label: "樱空", colors: "linear-gradient(135deg,#f7c5d9,#a8d5f6)" },
  { value: "mint", label: "薄荷", colors: "linear-gradient(135deg,#b8e9d9,#a9d3ef)" },
  { value: "sunset", label: "落日", colors: "linear-gradient(135deg,#f6b09e,#efd292)" },
  { value: "lavender", label: "鸢尾", colors: "linear-gradient(135deg,#d4bdf2,#a9cef0)" },
  { value: "midnight", label: "夜航", colors: "linear-gradient(135deg,#29283e,#253e59)" }
];

function loadAppearance(): Appearance {
  const fallback: Appearance = {
    theme: "blossom",
    dim: 22,
    blur: 0,
    headline: DEFAULT_HEADLINE,
    background: ""
  };
  try {
    const saved = uni.getStorageSync(APPEARANCE_KEY);
    const value = typeof saved === "string" ? JSON.parse(saved) : saved;
    return value && typeof value === "object" ? { ...fallback, ...value } : fallback;
  } catch {
    return fallback;
  }
}

const {
  todos,
  saving,
  createTodo,
  updateTodo,
  toggleTodo,
  removeTodo,
  clearCompleted
} = useTodoStore();

const now = new Date();
const selectedDate = ref(startOfDay(now));
const visibleMonth = ref(new Date(now.getFullYear(), now.getMonth(), 1));
const filter = ref<TodoFilter>("all");
const showTodoDialog = ref(false);
const showAppearanceDialog = ref(false);
const editingId = ref<string | null>(null);
const appearance = reactive<Appearance>(loadAppearance());
const form = reactive({
  text: "",
  startDate: "",
  startTime: "",
  endDate: "",
  endTime: "",
  error: ""
});

watch(
  appearance,
  (value) => {
    uni.setStorageSync(APPEARANCE_KEY, JSON.stringify(value));
  },
  { deep: true }
);

onShow(() => {
  // 页面从后台返回时，刷新逾期状态和“今天”的判断。
  selectedDate.value = new Date(selectedDate.value);
});

function isRelated(todo: TodoItem, date: Date): boolean {
  return (
    new Date(todo.startAt) <= endOfDay(date) &&
    new Date(todo.endAt) >= startOfDay(date)
  );
}

function eventsForDay(date: Date): TodoItem[] {
  return todos.value
    .filter((todo) => isRelated(todo, date))
    .sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt);
}

function relationFor(todo: TodoItem, date: Date) {
  const start = new Date(todo.startAt);
  const end = new Date(todo.endAt);
  return {
    isStart: sameDay(start, date),
    isEnd: sameDay(end, date),
    isRunning: start < startOfDay(date) && end > endOfDay(date)
  };
}

const calendarDays = computed(() => {
  const year = visibleMonth.value.getFullYear();
  const month = visibleMonth.value.getMonth();
  const first = new Date(year, month, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - mondayOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + index);
    const markers: Array<{
      todo: TodoItem;
      type: "start" | "end" | "running";
      label: string;
    }> = [];

    eventsForDay(date).forEach((todo) => {
      const relation = relationFor(todo, date);
      if (relation.isStart) markers.push({ todo, type: "start", label: "始" });
      if (relation.isEnd) markers.push({ todo, type: "end", label: "止" });
      if (relation.isRunning) markers.push({ todo, type: "running", label: "续" });
    });

    return {
      date,
      key: dateKey(date),
      number: date.getDate(),
      otherMonth: date.getMonth() !== month,
      today: sameDay(date, new Date()),
      selected: sameDay(date, selectedDate.value),
      markers
    };
  });
});

const selectedEvents = computed(() => eventsForDay(selectedDate.value));
const agendaTodos = computed(() => {
  if (filter.value === "active") {
    return selectedEvents.value.filter((todo) => !todo.completed);
  }
  if (filter.value === "completed") {
    return selectedEvents.value.filter((todo) => todo.completed);
  }
  return selectedEvents.value;
});
const progress = computed(() => {
  if (!selectedEvents.value.length) return 0;
  const completed = selectedEvents.value.filter((todo) => todo.completed).length;
  return Math.round((completed / selectedEvents.value.length) * 100);
});
const monthTitle = computed(
  () => `${visibleMonth.value.getFullYear()}年 ${visibleMonth.value.getMonth() + 1}月`
);
const selectedWeekday = computed(() => formatWeekday(selectedDate.value));
const selectedDateTitle = computed(
  () => `${selectedDate.value.getMonth() + 1}月${selectedDate.value.getDate()}日`
);
const pageClass = computed(() => [
  "page",
  `theme-${appearance.theme}`,
  { "has-background": Boolean(appearance.background) }
]);
const backgroundStyle = computed(() => ({
  backgroundImage: appearance.background
    ? `url("${appearance.background}")`
    : "none",
  filter: `blur(${appearance.blur}px)`,
  transform: appearance.blur ? "scale(1.06)" : "none"
}));
const tintStyle = computed(() => ({
  opacity: String(appearance.dim / 100)
}));

function selectDay(date: Date) {
  selectedDate.value = startOfDay(date);
  if (
    date.getMonth() !== visibleMonth.value.getMonth() ||
    date.getFullYear() !== visibleMonth.value.getFullYear()
  ) {
    visibleMonth.value = new Date(date.getFullYear(), date.getMonth(), 1);
  }
}

function changeMonth(offset: number) {
  visibleMonth.value = new Date(
    visibleMonth.value.getFullYear(),
    visibleMonth.value.getMonth() + offset,
    1
  );
}

function backToToday() {
  const today = new Date();
  selectedDate.value = startOfDay(today);
  visibleMonth.value = new Date(today.getFullYear(), today.getMonth(), 1);
}

function defaultTimes() {
  const start = new Date(selectedDate.value);
  const current = new Date();
  if (sameDay(start, current)) {
    start.setHours(current.getHours() + 1, 0, 0, 0);
  } else {
    start.setHours(9, 0, 0, 0);
  }
  return { start, end: new Date(start.getTime() + 60 * 60 * 1000) };
}

function fillForm(start: Date, end: Date, text = "") {
  form.text = text;
  form.startDate = dateKey(start);
  form.startTime = timeKey(start);
  form.endDate = dateKey(end);
  form.endTime = timeKey(end);
  form.error = "";
}

function openTodo(todo?: TodoItem) {
  editingId.value = todo?.id || null;
  if (todo) {
    fillForm(new Date(todo.startAt), new Date(todo.endAt), todo.text);
  } else {
    const defaults = defaultTimes();
    fillForm(defaults.start, defaults.end);
  }
  showTodoDialog.value = true;
}

function closeTodo() {
  showTodoDialog.value = false;
  editingId.value = null;
  form.error = "";
}

function saveTodo() {
  const text = form.text.trim();
  const start = parseDateTime(form.startDate, form.startTime);
  const end = parseDateTime(form.endDate, form.endTime);

  if (!text) {
    form.error = "请写下待办内容。";
    return;
  }
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    form.error = "请填写完整的开始和结束时间。";
    return;
  }
  if (end <= start) {
    form.error = "结束时间需要晚于开始时间。";
    return;
  }

  const input = { text, startAt: start.getTime(), endAt: end.getTime() };
  if (editingId.value) updateTodo(editingId.value, input);
  else createTodo(input);

  selectedDate.value = startOfDay(start);
  visibleMonth.value = new Date(start.getFullYear(), start.getMonth(), 1);
  closeTodo();
  uni.showToast({ title: "已保存", icon: "success" });
}

function deleteEditingTodo() {
  if (!editingId.value) return;
  removeTodo(editingId.value);
  closeTodo();
  uni.showToast({ title: "已删除", icon: "none" });
}

function timeDescription(todo: TodoItem): string {
  const start = new Date(todo.startAt);
  const end = new Date(todo.endAt);
  if (sameDay(start, end)) return `${formatTime(start)} — ${formatTime(end)}`;
  return `${formatShortDate(start)} ${formatTime(start)} — ${formatShortDate(end)} ${formatTime(end)}`;
}

function tagsFor(todo: TodoItem) {
  const relation = relationFor(todo, selectedDate.value);
  const tags: Array<{ label: string; type: string }> = [];
  if (relation.isStart) tags.push({ label: "当天开始", type: "start" });
  if (relation.isEnd) tags.push({ label: "当天截止", type: "end" });
  if (relation.isRunning) tags.push({ label: "进行中", type: "running" });
  if (!todo.completed && todo.endAt < Date.now()) {
    tags.push({ label: "已逾期", type: "overdue" });
  }
  return tags;
}

function confirmClearCompleted() {
  if (!todos.value.some((todo) => todo.completed)) return;
  uni.showModal({
    title: "清除已完成待办",
    content: "确定要清除所有已完成的待办吗？",
    success: ({ confirm }) => {
      if (confirm) clearCompleted();
    }
  });
}

function chooseBackground() {
  uni.chooseImage({
    count: 1,
    sizeType: ["compressed"],
    sourceType: ["album", "camera"],
    success: (result) => {
      const tempPath = result.tempFilePaths[0];
      // #ifdef H5
      const tempFiles = result.tempFiles;
      const file = Array.isArray(tempFiles) ? tempFiles[0] : tempFiles;
      if (file && typeof FileReader !== "undefined") {
        const reader = new FileReader();
        reader.onload = () => {
          appearance.background = String(reader.result || "");
        };
        reader.readAsDataURL(file as File);
        return;
      }
      // #endif

      // #ifndef H5
      uni.saveFile({
        tempFilePath: tempPath,
        success: ({ savedFilePath }) => {
          appearance.background = savedFilePath;
        },
        fail: () => {
          appearance.background = tempPath;
        }
      });
      // #endif
    }
  });
}

function removeBackground() {
  appearance.background = "";
}

function resetHeadline() {
  appearance.headline = DEFAULT_HEADLINE;
}

function onStartDate(event: any) {
  form.startDate = event.detail.value;
}

function onStartTime(event: any) {
  form.startTime = event.detail.value;
}

function onEndDate(event: any) {
  form.endDate = event.detail.value;
}

function onEndTime(event: any) {
  form.endTime = event.detail.value;
}
</script>

<template>
  <view :class="pageClass">
    <view class="custom-background" :style="backgroundStyle" />
    <view class="background-tint" :style="tintStyle" />
    <view class="ambient ambient-pink" />
    <view class="ambient ambient-blue" />

    <view class="app-shell">
      <view class="topbar">
        <view class="headline">
          <text class="eyebrow">{{ formatLongToday(new Date()) }}</text>
          <text class="headline-text">{{ appearance.headline || DEFAULT_HEADLINE }}</text>
        </view>
        <view class="top-actions">
          <button class="appearance-button" @tap="showAppearanceDialog = true">
            ◌ 外观
          </button>
          <button class="primary-button" @tap="openTodo()">＋ 新建待办</button>
        </view>
      </view>

      <view class="workspace">
        <view class="calendar-panel">
          <view class="calendar-nav">
            <view class="month-title">
              <text class="month-text">{{ monthTitle }}</text>
              <button class="text-button" @tap="backToToday">回到今天</button>
            </view>
            <view class="month-actions">
              <button class="round-button" @tap="changeMonth(-1)">‹</button>
              <button class="round-button" @tap="changeMonth(1)">›</button>
            </view>
          </view>

          <view class="weekdays">
            <text v-for="weekday in weekdays" :key="weekday">{{ weekday }}</text>
          </view>

          <view class="calendar-grid">
            <view
              v-for="day in calendarDays"
              :key="day.key"
              class="calendar-day"
              :class="{
                'other-month': day.otherMonth,
                today: day.today,
                selected: day.selected
              }"
              @tap="selectDay(day.date)"
            >
              <text class="day-number">{{ day.number }}</text>
              <view class="day-events">
                <view
                  v-for="marker in day.markers.slice(0, 2)"
                  :key="`${day.key}-${marker.todo.id}-${marker.type}`"
                  class="day-event"
                  :class="[marker.type, { completed: marker.todo.completed }]"
                >
                  <text class="event-badge">{{ marker.label }}</text>
                  <text class="event-title">{{ marker.todo.text }}</text>
                </view>
                <text v-if="day.markers.length > 2" class="more-events">
                  还有 {{ day.markers.length - 2 }} 条
                </text>
              </view>
            </view>
          </view>

          <view class="legend">
            <view><text class="legend-dot start" />开始</view>
            <view><text class="legend-dot end" />截止</view>
            <view><text class="legend-dot running" />进行中</view>
          </view>
        </view>

        <view class="agenda-panel">
          <view class="agenda-header">
            <view>
              <text class="eyebrow">{{ selectedWeekday }}</text>
              <text class="selected-date">{{ selectedDateTitle }}</text>
            </view>
            <view class="day-progress">
              <text class="progress-value">{{ progress }}%</text>
              <text>完成</text>
            </view>
          </view>

          <view class="filters">
            <button
              v-for="option in filterOptions"
              :key="option.value"
              class="filter"
              :class="{ active: filter === option.value }"
              @tap="filter = option.value"
            >
              {{ option.label }}
            </button>
          </view>

          <scroll-view scroll-y class="agenda-list-wrap">
            <view
              v-for="todo in agendaTodos"
              :key="todo.id"
              class="todo-item"
              :class="{ completed: todo.completed }"
            >
              <button class="check-button" @tap.stop="toggleTodo(todo.id)">
                <text>✓</text>
              </button>
              <view class="todo-main" @tap="openTodo(todo)">
                <text class="todo-title">{{ todo.text }}</text>
                <text class="todo-time">{{ timeDescription(todo) }}</text>
              </view>
              <view class="todo-tags">
                <text
                  v-for="tag in tagsFor(todo)"
                  :key="tag.type"
                  class="todo-tag"
                  :class="tag.type"
                >
                  {{ tag.label }}
                </text>
              </view>
              <button class="edit-button" @tap="openTodo(todo)">•••</button>
            </view>

            <view v-if="!agendaTodos.length" class="empty-state">
              <view class="empty-orbit"><text /></view>
              <text class="empty-title">这一天很轻盈</text>
              <text class="empty-copy">点击“新建待办”安排一件小事吧。</text>
            </view>
          </scroll-view>

          <view class="agenda-footer">
            <view class="save-status" :class="{ saving }">
              <text class="status-dot" />
              <text>{{ saving ? "正在保存" : "已实时保存到本机" }}</text>
            </view>
            <button class="text-button" @tap="confirmClearCompleted">清除已完成</button>
          </view>
        </view>
      </view>
    </view>

    <view v-if="showTodoDialog" class="modal-mask">
      <view class="modal-card todo-dialog">
        <view class="dialog-head">
          <view>
            <text class="eyebrow">{{ editingId ? "编辑安排" : "新建安排" }}</text>
            <text class="dialog-title">{{ editingId ? "修改待办" : "添加待办" }}</text>
          </view>
          <button class="round-button" @tap="closeTodo">×</button>
        </view>

        <view class="field">
          <text class="field-label">待办内容</text>
          <input
            v-model="form.text"
            class="field-input"
            maxlength="120"
            placeholder="比如：整理本周工作计划"
          />
        </view>

        <view class="time-section">
          <text class="field-label"><text class="field-dot start" />开始时间</text>
          <view class="picker-row">
            <picker mode="date" :value="form.startDate" @change="onStartDate">
              <view class="picker-value">{{ form.startDate }}</view>
            </picker>
            <picker mode="time" :value="form.startTime" @change="onStartTime">
              <view class="picker-value">{{ form.startTime }}</view>
            </picker>
          </view>
        </view>

        <view class="time-section">
          <text class="field-label"><text class="field-dot end" />结束时间</text>
          <view class="picker-row">
            <picker mode="date" :value="form.endDate" @change="onEndDate">
              <view class="picker-value">{{ form.endDate }}</view>
            </picker>
            <picker mode="time" :value="form.endTime" @change="onEndTime">
              <view class="picker-value">{{ form.endTime }}</view>
            </picker>
          </view>
        </view>

        <text class="form-error">{{ form.error }}</text>

        <view class="dialog-actions">
          <button
            v-if="editingId"
            class="danger-button"
            @tap="deleteEditingTodo"
          >
            删除
          </button>
          <view class="action-spacer" />
          <button class="secondary-button" @tap="closeTodo">取消</button>
          <button class="primary-button" @tap="saveTodo">保存安排</button>
        </view>
      </view>
    </view>

    <view v-if="showAppearanceDialog" class="modal-mask">
      <scroll-view scroll-y class="modal-card appearance-dialog">
        <view class="dialog-head">
          <view>
            <text class="eyebrow">个性化</text>
            <text class="dialog-title">选择你的日历色彩</text>
          </view>
          <button class="round-button" @tap="showAppearanceDialog = false">×</button>
        </view>

        <view class="appearance-section">
          <view class="section-title-row">
            <view>
              <text class="section-title">首页文案</text>
              <text class="section-copy">自定义日历顶部显示的内容</text>
            </view>
            <button class="text-button" @tap="resetHeadline">恢复默认</button>
          </view>
          <input
            v-model="appearance.headline"
            class="field-input"
            maxlength="40"
            :placeholder="DEFAULT_HEADLINE"
          />
        </view>

        <view class="appearance-section">
          <text class="section-title">配色主题</text>
          <view class="theme-options">
            <button
              v-for="theme in themes"
              :key="theme.value"
              class="theme-option"
              :class="{ active: appearance.theme === theme.value }"
              @tap="appearance.theme = theme.value"
            >
              <view class="theme-preview" :style="{ background: theme.colors }">
                <text />
              </view>
              <text>{{ theme.label }}</text>
            </button>
          </view>
        </view>

        <view class="appearance-section">
          <view class="section-title-row">
            <view>
              <text class="section-title">自定义背景</text>
              <text class="section-copy">图片仅保存在当前设备</text>
            </view>
            <view class="background-actions">
              <button class="secondary-button" @tap="chooseBackground">选择图片</button>
              <button class="text-button danger-text" @tap="removeBackground">
                恢复默认
              </button>
            </view>
          </view>

          <view
            class="background-preview"
            :class="{ 'has-image': appearance.background }"
            :style="{
              backgroundImage: appearance.background
                ? `url('${appearance.background}')`
                : 'none'
            }"
          >
            <text v-if="!appearance.background">尚未选择自定义背景</text>
          </view>

          <view class="range-row">
            <text>背景遮罩</text>
            <slider
              :value="appearance.dim"
              min="0"
              max="60"
              active-color="#79afe1"
              block-size="18"
              @changing="appearance.dim = $event.detail.value"
              @change="appearance.dim = $event.detail.value"
            />
            <text>{{ appearance.dim }}%</text>
          </view>
          <view class="range-row">
            <text>背景模糊</text>
            <slider
              :value="appearance.blur"
              min="0"
              max="20"
              active-color="#79afe1"
              block-size="18"
              @changing="appearance.blur = $event.detail.value"
              @change="appearance.blur = $event.detail.value"
            />
            <text>{{ appearance.blur }}px</text>
          </view>
        </view>
      </scroll-view>
    </view>
  </view>
</template>

<style scoped>
.page {
  --ink: #3b384f;
  --soft-ink: #777187;
  --surface: 255, 255, 255;
  --line: 139, 136, 165;
  --accent-a: #eba0bf;
  --accent-b: #7ebcef;
  --accent-a-rgb: 235, 160, 191;
  --accent-b-rgb: 126, 188, 239;
  min-height: 100vh;
  position: relative;
  overflow: hidden;
  color: var(--soft-ink);
  background: linear-gradient(145deg, #fff8fb, #f3f8ff);
}

.theme-mint {
  --accent-a: #82cfb4;
  --accent-b: #77b7df;
  --accent-a-rgb: 130, 207, 180;
  --accent-b-rgb: 119, 183, 223;
  background: linear-gradient(145deg, #f6fffb, #f2f9ff);
}

.theme-sunset {
  --accent-a: #ed917f;
  --accent-b: #e7b45f;
  --accent-a-rgb: 237, 145, 127;
  --accent-b-rgb: 231, 180, 95;
  background: linear-gradient(145deg, #fff7f2, #fffbed);
}

.theme-lavender {
  --accent-a: #b99be2;
  --accent-b: #82b4e3;
  --accent-a-rgb: 185, 155, 226;
  --accent-b-rgb: 130, 180, 227;
  background: linear-gradient(145deg, #fbf8ff, #f2f7ff);
}

.theme-midnight {
  --ink: #e8e5f1;
  --soft-ink: #c2bdcf;
  --surface: 31, 31, 48;
  --line: 134, 132, 161;
  --accent-a: #c091cf;
  --accent-b: #6da7d2;
  --accent-a-rgb: 192, 145, 207;
  --accent-b-rgb: 109, 167, 210;
  background: linear-gradient(145deg, #171625, #172433);
}

.custom-background,
.background-tint,
.ambient {
  position: fixed;
  pointer-events: none;
}

.custom-background {
  inset: -24px;
  z-index: 0;
  background-position: center;
  background-size: cover;
}

.background-tint {
  inset: 0;
  z-index: 1;
  background: #171725;
}

.page:not(.has-background) .background-tint {
  display: none;
}

.ambient {
  z-index: 1;
  border-radius: 50%;
}

.ambient-pink {
  width: 500px;
  height: 500px;
  left: -230px;
  top: -260px;
  background: radial-gradient(circle, rgba(var(--accent-a-rgb), 0.25), transparent 68%);
}

.ambient-blue {
  width: 580px;
  height: 580px;
  right: -270px;
  bottom: -330px;
  background: radial-gradient(circle, rgba(var(--accent-b-rgb), 0.25), transparent 68%);
}

.app-shell {
  width: min(1180px, calc(100% - 32px));
  min-height: 100vh;
  position: relative;
  z-index: 2;
  margin: 0 auto;
  padding: calc(var(--status-bar-height) + 20px) 0 24px;
}

.topbar {
  min-height: 106px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 8px 6px 20px;
}

.headline {
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.eyebrow {
  display: block;
  margin-bottom: 6px;
  color: #9a93a8;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 1px;
}

.headline-text {
  overflow: hidden;
  color: var(--ink);
  font-size: 31px;
  font-weight: 700;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-actions,
.month-title,
.month-actions,
.calendar-nav,
.agenda-header,
.filters,
.agenda-footer,
.dialog-head,
.dialog-actions,
.section-title-row,
.background-actions,
.picker-row {
  display: flex;
  align-items: center;
}

.top-actions {
  flex: 0 0 auto;
  gap: 9px;
}

.primary-button,
.appearance-button,
.secondary-button,
.danger-button {
  min-height: 42px;
  margin: 0;
  padding: 0 17px;
  border-radius: 13px;
  font-size: 13px;
  font-weight: 600;
  line-height: 42px;
}

.primary-button {
  color: #fff;
  background: linear-gradient(135deg, var(--accent-a), var(--accent-b));
  box-shadow: 0 9px 22px rgba(119, 165, 218, 0.27);
}

.appearance-button {
  color: var(--soft-ink);
  background: rgba(var(--surface), 0.55);
  border: 1px solid rgba(var(--line), 0.16);
}

.workspace {
  overflow: hidden;
  border: 1px solid rgba(var(--line), 0.16);
  border-radius: 22px;
  background: rgba(var(--surface), 0.82);
  box-shadow: 0 18px 52px rgba(88, 83, 133, 0.09);
  backdrop-filter: blur(14px);
}

.calendar-panel,
.agenda-panel {
  padding: 24px 26px 20px;
}

.calendar-panel {
  border-bottom: 1px solid rgba(var(--line), 0.13);
}

.calendar-nav,
.agenda-header,
.agenda-footer,
.section-title-row {
  justify-content: space-between;
}

.month-title {
  gap: 10px;
}

.month-text {
  color: var(--ink);
  font-size: 20px;
  font-weight: 700;
}

.text-button,
.round-button,
.filter,
.edit-button,
.check-button,
.theme-option {
  margin: 0;
  padding: 0;
  border: 0;
  background: transparent;
}

.text-button {
  min-height: 30px;
  color: #9993a5;
  font-size: 11px;
  line-height: 30px;
}

.round-button {
  width: 34px;
  height: 34px;
  color: #817c91;
  border: 1px solid rgba(var(--line), 0.16);
  border-radius: 11px;
  background: rgba(var(--surface), 0.58);
  font-size: 20px;
  line-height: 32px;
}

.month-actions {
  gap: 7px;
}

.weekdays,
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}

.weekdays {
  padding: 13px 0 8px;
  color: #aaa5b4;
  font-size: 11px;
  text-align: center;
}

.calendar-grid {
  border-top: 1px solid rgba(var(--line), 0.1);
  border-left: 1px solid rgba(var(--line), 0.1);
}

.calendar-day {
  min-width: 0;
  min-height: 72px;
  padding: 7px 5px 4px;
  overflow: hidden;
  border-right: 1px solid rgba(var(--line), 0.1);
  border-bottom: 1px solid rgba(var(--line), 0.1);
}

.calendar-day.other-month {
  opacity: 0.48;
}

.calendar-day.selected {
  background: linear-gradient(
    145deg,
    rgba(var(--accent-a-rgb), 0.2),
    rgba(var(--accent-b-rgb), 0.22)
  );
  box-shadow: inset 0 0 0 1px rgba(var(--accent-b-rgb), 0.32);
}

.day-number {
  width: 25px;
  height: 25px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: var(--soft-ink);
  font-size: 12px;
  font-weight: 600;
}

.calendar-day.today .day-number {
  color: white;
  background: linear-gradient(135deg, var(--accent-a), var(--accent-b));
}

.day-events {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 4px;
}

.day-event {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 4px;
  color: var(--soft-ink);
  font-size: 9px;
}

.event-badge {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: #fff;
  border-radius: 4px;
  font-size: 8px;
  line-height: 14px;
  text-align: center;
}

.day-event.start .event-badge,
.legend-dot.start {
  background: #e99ab9;
}

.day-event.end .event-badge,
.legend-dot.end {
  background: #79afe1;
}

.day-event.running .event-badge,
.legend-dot.running {
  background: #aaa0d0;
}

.day-event.completed {
  opacity: 0.48;
  text-decoration: line-through;
}

.event-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.more-events {
  color: #9c96a7;
  font-size: 9px;
}

.legend {
  display: flex;
  gap: 17px;
  padding-top: 14px;
  color: #9e98a8;
  font-size: 10px;
}

.legend view {
  display: flex;
  align-items: center;
  gap: 5px;
}

.legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 3px;
}

.agenda-panel {
  min-height: 510px;
  display: flex;
  flex-direction: column;
}

.agenda-header {
  min-height: 62px;
}

.selected-date,
.dialog-title {
  display: block;
  color: var(--ink);
  font-size: 22px;
  font-weight: 700;
}

.day-progress {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  color: #aaa5b4;
  font-size: 9px;
}

.progress-value {
  color: var(--accent-b);
  font-size: 18px;
  font-weight: 700;
}

.filters {
  min-height: 57px;
  gap: 3px;
  border-bottom: 1px solid rgba(var(--line), 0.12);
}

.filter {
  min-height: 32px;
  padding: 0 11px;
  color: #9993a5;
  border-radius: 9px;
  font-size: 11px;
  line-height: 32px;
}

.filter.active {
  color: #5f769b;
  background: rgba(var(--accent-b-rgb), 0.14);
}

.agenda-list-wrap {
  height: 350px;
  flex: 1;
}

.todo-item {
  min-height: 72px;
  display: flex;
  align-items: center;
  gap: 11px;
  border-bottom: 1px solid rgba(var(--line), 0.11);
}

.check-button {
  width: 23px;
  height: 23px;
  flex: 0 0 auto;
  color: transparent;
  border: 1.5px solid #c8c5d3;
  border-radius: 8px;
  font-size: 13px;
  line-height: 20px;
}

.todo-item.completed .check-button {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(135deg, var(--accent-a), var(--accent-b));
}

.todo-main {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 5px;
  padding: 13px 0;
}

.todo-title {
  overflow: hidden;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.todo-time {
  color: #9d97a8;
  font-size: 10px;
}

.todo-item.completed .todo-title {
  color: #aaa6b3;
  text-decoration: line-through;
}

.todo-tags {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
}

.todo-tag {
  padding: 3px 6px;
  border-radius: 5px;
  font-size: 8px;
  white-space: nowrap;
}

.todo-tag.start {
  color: #bd6489;
  background: rgba(237, 160, 193, 0.14);
}

.todo-tag.end {
  color: #5586b4;
  background: rgba(126, 188, 239, 0.15);
}

.todo-tag.running {
  color: #766ca1;
  background: rgba(170, 160, 208, 0.15);
}

.todo-tag.overdue {
  color: #d46573;
  background: rgba(230, 100, 116, 0.11);
}

.edit-button {
  width: 30px;
  color: #aaa5b3;
  font-size: 11px;
  line-height: 30px;
}

.empty-state {
  min-height: 250px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #aaa5b4;
}

.empty-orbit {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(var(--accent-b-rgb), 0.28);
  border-radius: 50%;
}

.empty-orbit::before {
  width: 25px;
  height: 25px;
  content: "";
  border: 1px solid rgba(var(--accent-a-rgb), 0.35);
  border-radius: 50%;
}

.empty-orbit text {
  width: 7px;
  height: 7px;
  position: absolute;
  margin: -10px 0 0 35px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--accent-a), var(--accent-b));
}

.empty-title {
  margin-top: 13px;
  color: #858092;
  font-size: 14px;
  font-weight: 600;
}

.empty-copy {
  margin-top: 5px;
  font-size: 10px;
}

.agenda-footer {
  min-height: 38px;
  color: #aaa6b4;
  font-size: 9px;
}

.save-status {
  display: flex;
  align-items: center;
  gap: 6px;
}

.status-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #85caae;
  box-shadow: 0 0 0 3px rgba(133, 202, 174, 0.13);
}

.save-status.saving .status-dot {
  background: #efafc9;
}

.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(50, 49, 69, 0.34);
  backdrop-filter: blur(5px);
}

.modal-card {
  width: min(590px, 100%);
  max-height: calc(100vh - 48px);
  padding: 27px 28px 25px;
  overflow: hidden;
  color: var(--soft-ink);
  border: 1px solid rgba(var(--line), 0.2);
  border-radius: 22px;
  background: rgba(var(--surface), 0.98);
  box-shadow: 0 28px 80px rgba(68, 64, 105, 0.24);
}

.appearance-dialog {
  width: min(680px, 100%);
  height: auto;
  box-sizing: border-box;
}

.dialog-head {
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 24px;
}

.field,
.time-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.time-section {
  margin-top: 18px;
}

.field-label {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #8c8698;
  font-size: 11px;
  font-weight: 600;
}

.field-dot {
  width: 7px;
  height: 7px;
  border-radius: 3px;
}

.field-dot.start {
  background: #e99ab9;
}

.field-dot.end {
  background: #79afe1;
}

.field-input,
.picker-value {
  width: 100%;
  height: 45px;
  padding: 0 13px;
  color: var(--ink);
  border: 1px solid rgba(var(--line), 0.18);
  border-radius: 11px;
  background: rgba(var(--surface), 0.62);
  font-size: 12px;
  line-height: 45px;
}

.picker-row {
  gap: 9px;
}

.picker-row picker {
  min-width: 0;
  flex: 1;
}

.form-error {
  min-height: 18px;
  display: block;
  margin-top: 10px;
  color: #d56577;
  font-size: 10px;
}

.dialog-actions {
  gap: 9px;
  margin-top: 8px;
}

.action-spacer {
  flex: 1;
}

.secondary-button,
.danger-button {
  min-height: 40px;
  line-height: 40px;
}

.secondary-button {
  color: var(--soft-ink);
  background: rgba(var(--line), 0.1);
}

.danger-button {
  color: #d36779;
  background: rgba(226, 107, 126, 0.08);
}

.appearance-section {
  padding: 18px 0 20px;
  border-top: 1px solid rgba(var(--line), 0.13);
}

.section-title,
.section-copy {
  display: block;
}

.section-title {
  color: var(--ink);
  font-size: 12px;
  font-weight: 700;
}

.section-copy {
  margin-top: 5px;
  color: #9c96a7;
  font-size: 9px;
}

.appearance-section > .field-input {
  margin-top: 14px;
}

.theme-options {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 9px;
  margin-top: 13px;
}

.theme-option {
  min-width: 0;
  padding: 7px;
  color: var(--soft-ink);
  border: 1px solid transparent;
  border-radius: 12px;
  font-size: 10px;
  line-height: 24px;
  text-align: left;
}

.theme-option.active {
  border-color: rgba(var(--accent-b-rgb), 0.42);
  background: rgba(var(--accent-b-rgb), 0.09);
}

.theme-preview {
  height: 52px;
  position: relative;
  overflow: hidden;
  border-radius: 9px;
}

.theme-preview text {
  width: 18px;
  height: 18px;
  position: absolute;
  right: 8px;
  bottom: 8px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.72);
}

.background-actions {
  gap: 5px;
}

.danger-text {
  color: #cf7485;
}

.background-preview {
  height: 105px;
  margin-top: 13px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a29cab;
  border: 1px dashed rgba(var(--line), 0.28);
  border-radius: 13px;
  background:
    linear-gradient(
      135deg,
      rgba(var(--accent-a-rgb), 0.1),
      rgba(var(--accent-b-rgb), 0.12)
    );
  background-position: center;
  background-size: cover;
  font-size: 10px;
}

.range-row {
  display: grid;
  grid-template-columns: 65px 1fr 40px;
  align-items: center;
  gap: 8px;
  margin-top: 12px;
  color: var(--soft-ink);
  font-size: 10px;
}

.range-row slider {
  margin: 0;
}

@media (min-width: 900px) {
  .workspace {
    display: grid;
    grid-template-columns: minmax(520px, 1.12fr) minmax(360px, 0.88fr);
  }

  .calendar-panel {
    border-right: 1px solid rgba(var(--line), 0.13);
    border-bottom: 0;
  }

  .agenda-panel {
    height: 594px;
    min-height: 0;
  }
}

@media (max-width: 680px) {
  .app-shell {
    width: calc(100% - 20px);
    padding-bottom: 12px;
  }

  .topbar {
    min-height: 132px;
    align-items: flex-start;
    flex-direction: column;
    gap: 14px;
    padding: 8px 4px 17px;
  }

  .headline-text {
    max-width: calc(100vw - 28px);
    font-size: 25px;
  }

  .top-actions {
    width: 100%;
  }

  .top-actions button {
    flex: 1;
  }

  .calendar-panel,
  .agenda-panel {
    padding: 19px 13px 16px;
  }

  .calendar-day {
    min-height: 54px;
    padding: 5px 2px 3px;
  }

  .day-number {
    width: 22px;
    height: 22px;
    font-size: 11px;
  }

  .event-title,
  .more-events {
    display: none;
  }

  .day-events {
    flex-direction: row;
    gap: 2px;
  }

  .event-badge {
    width: 12px;
    height: 12px;
    font-size: 7px;
    line-height: 12px;
  }

  .agenda-panel {
    min-height: 480px;
  }

  .agenda-list-wrap {
    height: 330px;
  }

  .todo-item {
    gap: 8px;
  }

  .todo-tags {
    display: none;
  }

  .modal-mask {
    align-items: flex-end;
    padding: 10px;
  }

  .modal-card {
    max-height: calc(100vh - 20px);
    padding: 23px 18px 20px;
    border-radius: 22px 22px 14px 14px;
  }

  .theme-options {
    grid-template-columns: repeat(3, 1fr);
  }

  .section-title-row {
    align-items: flex-start;
    gap: 10px;
  }

  .background-actions {
    align-items: flex-end;
    flex-direction: column;
  }

  .dialog-actions .primary-button,
  .dialog-actions .secondary-button,
  .dialog-actions .danger-button {
    padding: 0 12px;
  }
}
</style>
