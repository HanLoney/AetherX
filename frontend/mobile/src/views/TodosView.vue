<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { Check, ChevronLeft, ChevronRight, Plus, Trash2, X } from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import EmptyState from "../components/EmptyState.vue";
import type { Todo } from "../lib/api";
import { useDataStore } from "../stores/data";

interface CalendarDay {
  key: string;
  date: Date;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  todos: Todo[];
}

const data = useDataStore();
const todayKey = dateKey(Date.now());
const selectedDateKey = ref(todayKey);
const visibleMonth = ref(monthStart(Date.now()).getTime());
const editorOpen = ref(false);
const text = ref("");
const date = ref(toLocalInput(Date.now()));
const endDate = ref(toLocalInput(Date.now() + 3_600_000));
const saving = ref(false);
const error = ref("");
const todayButtonTilt = ref(0);
let targetTodayButtonTilt = 0;
let swingFrame = 0;

const selectedDateLabel = computed(() => {
  const value = parseDateKey(selectedDateKey.value);
  return new Intl.DateTimeFormat("zh-CN", {
    month: "long",
    day: "numeric",
    weekday: "long"
  }).format(value);
});

const monthLabel = computed(() => new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "long"
}).format(visibleMonth.value));

const selectedTodos = computed(() =>
  data.todos.value
    .filter((todo) => dateKey(todo.startAt) === selectedDateKey.value)
    .sort((a, b) => a.startAt - b.startAt)
);

const activeSelectedTodos = computed(() => selectedTodos.value.filter((todo) => !todo.completed));

const calendarDays = computed<CalendarDay[]>(() => {
  const start = new Date(visibleMonth.value);
  const firstDay = new Date(start.getFullYear(), start.getMonth(), 1);
  const gridStart = new Date(firstDay);
  gridStart.setDate(firstDay.getDate() - firstDay.getDay());

  return Array.from({ length: 42 }, (_, index) => {
    const current = new Date(gridStart);
    current.setDate(gridStart.getDate() + index);
    const key = dateKey(current.getTime());
    return {
      key,
      date: current,
      day: current.getDate(),
      inMonth: current.getMonth() === start.getMonth(),
      isToday: key === todayKey,
      todos: data.todos.value.filter((todo) => dateKey(todo.startAt) === key)
    };
  });
});

async function createTodo() {
  if (!text.value.trim()) return;
  saving.value = true;
  error.value = "";
  try {
    const startAt = new Date(date.value).getTime();
    await data.addTodo({ text: text.value.trim(), startAt, endAt: new Date(endDate.value).getTime() });
    selectedDateKey.value = dateKey(startAt);
    visibleMonth.value = monthStart(startAt).getTime();
    text.value = "";
    editorOpen.value = false;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "待办没有保存成功。";
  } finally {
    saving.value = false;
  }
}

function selectDay(day: CalendarDay) {
  selectedDateKey.value = day.key;
  if (!day.inMonth) visibleMonth.value = monthStart(day.date.getTime()).getTime();
}

function changeMonth(offset: number) {
  const current = new Date(visibleMonth.value);
  const next = new Date(current.getFullYear(), current.getMonth() + offset, 1);
  visibleMonth.value = next.getTime();
}

function goToday() {
  const now = Date.now();
  selectedDateKey.value = dateKey(now);
  visibleMonth.value = monthStart(now).getTime();
}

function handleDeviceMotion(event: DeviceMotionEvent) {
  const x = event.accelerationIncludingGravity?.x ?? 0;
  targetTodayButtonTilt = Math.max(-19, Math.min(19, x * 3.2));
}

function animateTodayButtonSwing() {
  todayButtonTilt.value += (targetTodayButtonTilt - todayButtonTilt.value) * .16;
  targetTodayButtonTilt *= .985;
  if (Math.abs(todayButtonTilt.value) < .05 && Math.abs(targetTodayButtonTilt) < .05) {
    todayButtonTilt.value = 0;
    targetTodayButtonTilt = 0;
  }
  swingFrame = window.requestAnimationFrame(animateTodayButtonSwing);
}

function openEditor() {
  const start = parseDateKey(selectedDateKey.value);
  const now = new Date();
  start.setHours(now.getHours(), now.getMinutes(), 0, 0);
  date.value = toLocalInput(start.getTime());
  endDate.value = toLocalInput(start.getTime() + 3_600_000);
  editorOpen.value = true;
}

function monthStart(value: number) {
  const dateValue = new Date(value);
  return new Date(dateValue.getFullYear(), dateValue.getMonth(), 1);
}

function parseDateKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function dateKey(value: number) {
  const dateValue = new Date(value);
  const year = dateValue.getFullYear();
  const month = String(dateValue.getMonth() + 1).padStart(2, "0");
  const day = String(dateValue.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(value: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}

function toLocalInput(value: number) {
  const local = new Date(value - new Date(value).getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

onMounted(() => {
  window.addEventListener("devicemotion", handleDeviceMotion);
  swingFrame = window.requestAnimationFrame(animateTodayButtonSwing);
});

onBeforeUnmount(() => {
  window.removeEventListener("devicemotion", handleDeviceMotion);
  if (swingFrame) window.cancelAnimationFrame(swingFrame);
});
</script>

<template>
  <AppShell title="日历待办" kicker="把生活放在看得见的地方">
    <template #header>
      <button class="add-button" aria-label="新增待办" @click="openEditor">
        <Plus :size="20" />
      </button>
    </template>

    <section class="calendar-panel">
      <div class="calendar-toolbar">
        <button class="month-button" aria-label="上个月" @click="changeMonth(-1)">
          <ChevronLeft :size="18" />
        </button>
        <strong>{{ monthLabel }}</strong>
        <button class="month-button" aria-label="下个月" @click="changeMonth(1)">
          <ChevronRight :size="18" />
        </button>
      </div>

      <div class="weekday-row" aria-hidden="true">
        <span>日</span>
        <span>一</span>
        <span>二</span>
        <span>三</span>
        <span>四</span>
        <span>五</span>
        <span>六</span>
      </div>

      <div class="calendar-grid">
        <button
          v-for="day in calendarDays"
          :key="day.key"
          class="day-cell"
          :class="{
            muted: !day.inMonth,
            today: day.isToday,
            selected: selectedDateKey === day.key,
            'has-todos': day.todos.length
          }"
          @click="selectDay(day)"
        >
          <span>{{ day.day }}</span>
          <i v-if="day.todos.length">{{ day.todos.length }}</i>
        </button>
      </div>

      <button
        class="today-float-button"
        :style="{ '--swing-angle': `${todayButtonTilt}deg` }"
        aria-label="回到今天"
        @click="goToday"
      >
        <svg class="wind-chime-icon" viewBox="0 0 48 88" aria-hidden="true">
          <defs>
            <linearGradient id="todayChimeGradient" x1="4" y1="4" x2="44" y2="86" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="#d08caf" />
              <stop offset=".58" stop-color="#9b83bd" />
              <stop offset="1" stop-color="#78a9d3" />
            </linearGradient>
            <linearGradient id="todayChimeHighlight" x1="10" y1="14" x2="34" y2="56" gradientUnits="userSpaceOnUse">
              <stop offset="0" stop-color="#ffffff" stop-opacity=".44" />
              <stop offset="1" stop-color="#ffffff" stop-opacity=".08" />
            </linearGradient>
          </defs>
          <path class="wind-chime-pin" d="M24 4v12" />
          <path class="wind-chime-body" d="M24 16C11.5 16 4 26.8 4 40.5 4 46 5.2 50.6 7.7 55h32.6c2.5-4.4 3.7-9 3.7-14.5C44 26.8 36.5 16 24 16Z" />
          <path class="wind-chime-gloss" d="M13 47c-1.5-10.8 2.2-20.4 12.5-25.5 7.2 1 12.1 5.4 14.2 12.2-4.6-5.6-10.5-8.3-17.7-7.8-6.4 3.8-9.2 10.5-9 21.1Z" />
          <path class="wind-chime-pin" d="M24 55v9" />
          <rect class="wind-chime-tail" x="18" y="64" width="12" height="22" rx="3" />
          <text x="24" y="43" text-anchor="middle">今</text>
        </svg>
      </button>
    </section>

    <section class="todo-sheet">
      <div class="selected-day-header">
        <div>
          <span>选中日期</span>
          <strong>{{ selectedDateLabel }}</strong>
        </div>
        <b>{{ activeSelectedTodos.length }}/{{ selectedTodos.length }}</b>
      </div>

      <EmptyState
        v-if="!selectedTodos.length"
        title="这一天还没有待办"
        description="点右上角的加号，把事情放到选中的日期里。"
      />
      <article v-for="todo in selectedTodos" :key="todo.id" class="todo-row" :class="{ done: todo.completed }">
        <button class="check-button" aria-label="切换完成状态" @click="data.toggleTodo(todo)">
          <Check :size="15" />
        </button>
        <div>
          <strong>{{ todo.text }}</strong>
          <time>{{ dateLabel(todo.startAt) }} - {{ dateLabel(todo.endAt) }}</time>
        </div>
        <button class="delete-button" aria-label="删除" @click="data.removeTodo(todo.id)">
          <Trash2 :size="16" />
        </button>
      </article>
    </section>

    <Transition name="fade">
      <div v-if="editorOpen" class="sheet-backdrop" @click.self="editorOpen = false">
        <form class="bottom-sheet" @submit.prevent="createTodo">
          <div class="sheet-handle" />
          <div class="sheet-title">
            <h2>记下一件事</h2>
            <button type="button" class="icon-button" aria-label="关闭" @click="editorOpen = false">
              <X :size="18" />
            </button>
          </div>
          <div class="editor-fields">
            <div class="field">
              <label>要做什么</label>
              <textarea v-model="text" autofocus placeholder="简短写下这件事…" />
            </div>
            <div class="field">
              <label>开始</label>
              <input v-model="date" type="datetime-local" />
            </div>
            <div class="field">
              <label>结束</label>
              <input v-model="endDate" type="datetime-local" />
            </div>
          </div>
          <p v-if="error" class="error-banner">{{ error }}</p>
          <button class="primary-button save-todo" :disabled="saving || !text.trim()">
            {{ saving ? "保存中…" : "放进日程" }}
          </button>
        </form>
      </div>
    </Transition>
  </AppShell>
</template>

<style scoped>
.add-button{width:45px;height:45px;display:grid;place-items:center;border:0;border-radius:16px;color:#fff;background:linear-gradient(135deg,#d08caf,#78a9d3);box-shadow:0 10px 25px rgba(130,111,160,.22)}
.calendar-panel{position:relative;z-index:3;padding:16px 14px 18px;border:1px solid rgba(255,255,255,.82);border-radius:24px;background:rgba(255,255,255,.72);box-shadow:var(--shadow);backdrop-filter:blur(18px)}
.calendar-toolbar{height:42px;display:grid;grid-template-columns:42px 1fr 42px;align-items:center;gap:8px;margin-bottom:8px}.calendar-toolbar strong{text-align:center;color:#4f4a5f;font-size:calc(16px * var(--font-scale, 1));letter-spacing:0}.month-button{width:42px;height:42px;display:grid;place-items:center;border:0;border-radius:14px;color:#736d82;background:rgba(255,255,255,.66);box-shadow:inset 0 0 0 1px var(--line)}
.weekday-row,.calendar-grid{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}.weekday-row{margin-bottom:7px}.weekday-row span{height:24px;display:grid;place-items:center;color:#9a94a5;font-size:calc(10px * var(--font-scale, 1));font-weight:800}
.day-cell{position:relative;aspect-ratio:1;min-width:0;display:grid;place-items:center;border:0;border-radius:8px;color:#5a5567;background:rgba(248,247,252,.72);font-size:calc(12px * var(--font-scale, 1));font-weight:750;transition:transform .16s ease,box-shadow .16s ease,background .16s ease}.day-cell span{position:relative;z-index:1;line-height:1}.day-cell.muted{color:#b7b1be;background:rgba(255,255,255,.42)}.day-cell.today{box-shadow:inset 0 0 0 1px rgba(var(--blue-rgb),.42)}.day-cell.selected{color:#fff;background:linear-gradient(135deg,#d08caf,#78a9d3);box-shadow:0 11px 21px rgba(126,111,160,.23)}.day-cell.has-todos::after{content:"";position:absolute;left:50%;bottom:5px;width:4px;height:4px;border-radius:50%;background:var(--pink);transform:translateX(-50%)}.day-cell.selected::after{background:#fff}.day-cell i{position:absolute;right:2px;top:2px;min-width:12px;height:12px;display:grid;place-items:center;border-radius:999px;color:#fff;background:#78a9d3;font-size:calc(7px * var(--font-scale, 1));font-style:normal;font-weight:800;line-height:1;box-shadow:0 2px 6px rgba(103,96,132,.16)}.day-cell.selected i{color:#7e6d91;background:#fff}
.today-float-button{position:absolute;z-index:8;right:17px;bottom:-40px;width:36px;height:58px;display:grid;place-items:center;border:0;border-radius:16px;color:#fff;background:transparent;filter:drop-shadow(0 10px 14px rgba(126,111,160,.22));transform-origin:50% 4px;transform:rotate(var(--swing-angle,0deg))}.wind-chime-icon{width:31px;height:56px;overflow:visible}.wind-chime-body,.wind-chime-tail{fill:url(#todayChimeGradient);stroke:rgba(255,255,255,.56);stroke-width:1.8}.wind-chime-pin{fill:none;stroke:#9b83bd;stroke-width:4;stroke-linecap:round;stroke-linejoin:round}.wind-chime-gloss{fill:url(#todayChimeHighlight)}.wind-chime-icon text{fill:#fff;font-size:17px;font-weight:900;dominant-baseline:middle;text-shadow:0 1px 4px rgba(83,65,121,.3)}
.todo-sheet{position:relative;z-index:1;min-height:260px;margin-top:22px;padding:17px 19px 20px;border:1px solid rgba(255,255,255,.82);border-radius:12px 28px 28px 12px;background:repeating-linear-gradient(to bottom,rgba(255,255,255,.72) 0,rgba(255,255,255,.72) 46px,rgba(112,147,180,.09) 47px,rgba(255,255,255,.72) 48px);box-shadow:var(--shadow);backdrop-filter:blur(18px)}.todo-sheet::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;border-radius:8px;background:linear-gradient(var(--pink),var(--blue));opacity:.55}
.selected-day-header{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:52px;border-bottom:1px solid rgba(105,98,130,.09)}.selected-day-header div{min-width:0;display:grid;gap:4px}.selected-day-header span{color:#9a94a5;font-size:calc(10px * var(--font-scale, 1));font-weight:800}.selected-day-header strong{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4c4859;font-size:calc(15px * var(--font-scale, 1))}.selected-day-header b{display:grid;place-items:center;min-width:42px;height:27px;border-radius:999px;color:#fff;background:linear-gradient(135deg,var(--pink),var(--blue));font-size:calc(11px * var(--font-scale, 1))}
.todo-row{min-height:72px;display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:13px;border-bottom:1px solid rgba(105,98,130,.09)}.todo-row>div{min-width:0;display:grid;gap:5px}.todo-row strong{overflow:hidden;text-overflow:ellipsis;color:#4c4859;font-size:calc(13px * var(--font-scale, 1))}.todo-row time{color:#9892a2;font-family:Georgia,serif;font-size:calc(10px * var(--font-scale, 1))}.check-button{width:29px;height:29px;display:grid;place-items:center;border:1px solid rgba(var(--blue-rgb),.35);border-radius:50%;color:transparent;background:rgba(255,255,255,.62)}.done .check-button{color:#fff;border:0;background:linear-gradient(135deg,var(--pink),var(--blue))}.done strong{text-decoration:line-through;color:#a19baa}.delete-button{width:35px;height:35px;display:grid;place-items:center;border:0;color:#b5afbb;background:transparent}.editor-fields{display:grid;gap:15px}.save-todo{width:100%;margin-top:19px}
</style>
