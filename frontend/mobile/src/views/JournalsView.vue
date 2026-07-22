<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterLink } from "vue-router";
import {
  ArrowLeft,
  BookOpen,
  ChevronLeft,
  ChevronRight
} from "@lucide/vue";
import AppShell from "../components/AppShell.vue";
import type { Journal } from "../lib/api";
import { resolveJournalTurn } from "../lib/journal-pagination";
import { renderMarkdown } from "../lib/markdown";
import { useDataStore } from "../stores/data";

type JournalFilter = "all" | Journal["type"];
type PaperTurnClass = ""
  | "leaving-forward"
  | "leaving-backward"
  | "entering-forward"
  | "entering-backward";

const data = useDataStore();
const filter = ref<JournalFilter>("all");
const journalIndex = ref(0);
const leafIndex = ref(0);
const leafCount = ref(1);
const paperViewport = ref<HTMLElement | null>(null);
const pageFlow = ref<HTMLElement | null>(null);
const columnWidth = ref(0);
const flowTransitionEnabled = ref(true);
const paperTurnClass = ref<PaperTurnClass>("");
const journalTurnInProgress = ref(false);
const columnGap = 48;
let resizeObserver: ResizeObserver | undefined;
let measureFrame = 0;
let turnFrame = 0;
let turnTimer: ReturnType<typeof setTimeout> | undefined;
let pendingJournalTurn: 1 | -1 | 0 = 0;
let openPreviousAtLastLeaf = false;
let touchStartX = 0;
let touchStartY = 0;

const filters: Array<{ value: JournalFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "daily", label: "日记" },
  { value: "weekly", label: "周记" }
];

const assistantName = computed(() => String(data.assistant.value.name || "AI 伙伴"));
const filteredJournals = computed(() => (
  filter.value === "all"
    ? data.journals.value
    : data.journals.value.filter((journal) => journal.type === filter.value)
));
const currentJournal = computed(() => filteredJournals.value[journalIndex.value] || null);
const renderedJournal = computed(() => renderMarkdown(currentJournal.value?.content));
const pageLabel = computed(() => (
  filteredJournals.value.length
    ? `${leafIndex.value + 1} / ${leafCount.value} 页 · ${journalIndex.value + 1} / ${filteredJournals.value.length} 篇`
    : "0 / 0"
));
const pageFlowStyle = computed(() => ({
  "--journal-column-width": columnWidth.value ? `${columnWidth.value}px` : "100%",
  "--journal-column-gap": `${columnGap}px`,
  transform: `translate3d(-${leafIndex.value * (columnWidth.value + columnGap)}px, 0, 0)`
}));
const canTurnBackward = computed(() => !journalTurnInProgress.value
  && (journalIndex.value > 0 || leafIndex.value > 0));
const canTurnForward = computed(() => (
  !journalTurnInProgress.value
  && (leafIndex.value < leafCount.value - 1
    || journalIndex.value < filteredJournals.value.length - 1)
));

watch(filter, async () => {
  cancelJournalTurn();
  flowTransitionEnabled.value = false;
  pendingJournalTurn = 0;
  openPreviousAtLastLeaf = false;
  journalIndex.value = 0;
  leafIndex.value = 0;
  await scheduleMeasure();
});

watch(() => filteredJournals.value.length, async (length) => {
  flowTransitionEnabled.value = false;
  if (!length) journalIndex.value = 0;
  else if (journalIndex.value >= length) journalIndex.value = length - 1;
  leafIndex.value = 0;
  await scheduleMeasure();
});

watch(() => currentJournal.value?.id, async () => {
  if (!pendingJournalTurn) flowTransitionEnabled.value = false;
  leafCount.value = 1;
  leafIndex.value = 0;
  await scheduleMeasure();
});

function measurePages() {
  const viewport = paperViewport.value;
  const flow = pageFlow.value;
  if (!viewport || !flow || !currentJournal.value) {
    leafCount.value = 1;
    return;
  }

  const width = Math.max(1, Math.floor(viewport.clientWidth));
  columnWidth.value = width;
  flow.style.setProperty("--journal-column-width", `${width}px`);
  const step = width + columnGap;

  requestAnimationFrame(() => {
    if (!pageFlow.value) return;
    leafCount.value = Math.max(1, Math.round((pageFlow.value.scrollWidth + columnGap) / step));
    if (openPreviousAtLastLeaf) {
      leafIndex.value = leafCount.value - 1;
      openPreviousAtLastLeaf = false;
    } else if (leafIndex.value >= leafCount.value) {
      leafIndex.value = leafCount.value - 1;
    }
    requestAnimationFrame(() => {
      flowTransitionEnabled.value = true;
      if (pendingJournalTurn) {
        enterJournalPage(pendingJournalTurn);
        pendingJournalTurn = 0;
      }
    });
  });
}

async function scheduleMeasure() {
  await nextTick();
  cancelAnimationFrame(measureFrame);
  measureFrame = requestAnimationFrame(measurePages);
}

function cancelJournalTurn() {
  cancelAnimationFrame(turnFrame);
  if (turnTimer) clearTimeout(turnTimer);
  paperTurnClass.value = "";
  journalTurnInProgress.value = false;
}

function enterJournalPage(direction: 1 | -1) {
  cancelAnimationFrame(turnFrame);
  if (turnTimer) clearTimeout(turnTimer);
  paperTurnClass.value = "";
  turnFrame = requestAnimationFrame(() => {
    paperTurnClass.value = direction > 0 ? "entering-forward" : "entering-backward";
    turnTimer = setTimeout(() => {
      paperTurnClass.value = "";
      journalTurnInProgress.value = false;
    }, 190);
  });
}

function crossJournal(
  target: ReturnType<typeof resolveJournalTurn>,
  direction: 1 | -1
) {
  journalTurnInProgress.value = true;
  cancelAnimationFrame(turnFrame);
  if (turnTimer) clearTimeout(turnTimer);
  paperTurnClass.value = direction > 0 ? "leaving-forward" : "leaving-backward";
  turnTimer = setTimeout(() => {
    flowTransitionEnabled.value = false;
    pendingJournalTurn = direction;
    openPreviousAtLastLeaf = target.leafIndex === "last";
    leafIndex.value = 0;
    journalIndex.value = target.journalIndex;
  }, 170);
}

function turnPage(offset: 1 | -1) {
  if (journalTurnInProgress.value) return;
  const target = resolveJournalTurn({
    journalIndex: journalIndex.value,
    journalCount: filteredJournals.value.length,
    leafIndex: leafIndex.value,
    leafCount: leafCount.value
  }, offset);
  if (!target.moved) return;
  if (!target.crossedJournal) {
    leafIndex.value = target.leafIndex as number;
    return;
  }

  crossJournal(target, offset);
}

function handleTouchStart(event: TouchEvent) {
  const touch = event.changedTouches[0];
  touchStartX = touch.clientX;
  touchStartY = touch.clientY;
}

function handleTouchEnd(event: TouchEvent) {
  const touch = event.changedTouches[0];
  const deltaX = touch.clientX - touchStartX;
  const deltaY = touch.clientY - touchStartY;
  if (Math.abs(deltaX) < 56 || Math.abs(deltaX) <= Math.abs(deltaY) * 1.2) return;
  turnPage(deltaX < 0 ? 1 : -1);
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    void scheduleMeasure();
  });
  if (paperViewport.value) resizeObserver.observe(paperViewport.value);
  void scheduleMeasure();
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
  cancelAnimationFrame(measureFrame);
  cancelJournalTurn();
});
</script>

<template>
  <AppShell title="手记" layout="focus" back-to="/home" headerless quiet>
    <div class="journal-view">
      <header class="reader-bar">
        <RouterLink class="reader-back" to="/home" aria-label="返回主页">
          <ArrowLeft :size="19" />
        </RouterLink>

        <div class="reader-identity">
          <BookOpen :size="16" />
          <div>
            <strong>{{ assistantName }}手记</strong>
            <span>{{ data.journals.value.length }} 篇</span>
          </div>
        </div>

        <div class="journal-filters" aria-label="筛选手记">
          <button
            v-for="item in filters"
            :key="item.value"
            type="button"
            :class="{ active: filter === item.value }"
            @click="filter = item.value"
          >
            {{ item.label }}
          </button>
        </div>
      </header>

      <div
        class="reader-stage"
        @touchstart.passive="handleTouchStart"
        @touchend.passive="handleTouchEnd"
      >
        <div v-if="currentJournal" class="journal-page" :class="paperTurnClass">
          <div ref="paperViewport" class="paper-viewport" @load.capture="scheduleMeasure">
            <article
              ref="pageFlow"
              class="page-flow"
              :class="{ 'without-transition': !flowTransitionEnabled }"
              :style="pageFlowStyle"
            >
            <div class="paper-heading">
              <div>
                <span>{{ currentJournal.type === "daily" ? "DIARY" : "WEEKLY NOTE" }}</span>
                <h1>{{ currentJournal.title }}</h1>
              </div>
              <time>{{ currentJournal.periodKey }}</time>
            </div>

              <!-- renderMarkdown disables raw HTML and unsafe link protocols. -->
              <div class="journal-content" v-html="renderedJournal" />

              <footer class="paper-meta">
                <span>{{ currentJournal.type === "daily" ? "日记" : "周记" }}</span>
                <i>{{ currentJournal.mood || "平静" }}</i>
              </footer>
            </article>
          </div>
        </div>

        <div v-else class="journal-page journal-empty">
          <BookOpen :size="28" />
          <strong>这一册还是空白的</strong>
          <p>{{ filter === "all" ? "她写下第一篇手记后，会从这里慢慢翻开。" : "这个分类里还没有手记。" }}</p>
        </div>
      </div>

      <footer class="reader-controls">
        <button
          type="button"
          aria-label="上一页"
          :disabled="!canTurnBackward"
          @click="turnPage(-1)"
        >
          <ChevronLeft :size="19" />
        </button>
        <div>
          <strong>{{ pageLabel }}</strong>
          <span>左右滑动翻页</span>
        </div>
        <button
          type="button"
          aria-label="下一页"
          :disabled="!canTurnForward"
          @click="turnPage(1)"
        >
          <ChevronRight :size="19" />
        </button>
      </footer>
    </div>
  </AppShell>
</template>

<style scoped>
.journal-view {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 14px;
  padding:
    max(12px, env(safe-area-inset-top))
    0
    max(12px, env(safe-area-inset-bottom));
}

.reader-bar {
  min-width: 0;
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.reader-back,
.reader-controls button {
  display: grid;
  place-items: center;
  border: 1px solid rgba(255,255,255,.84);
  color: #777082;
  background: rgba(255,255,255,.62);
  box-shadow:
    inset 0 1px 0 rgba(255,255,255,.92),
    0 10px 30px rgba(74,68,98,.1);
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
}

.reader-back {
  width: 42px;
  height: 42px;
  border-radius: 15px;
}

.reader-identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 9px;
  color: #4a4555;
}

.reader-identity > svg {
  flex: 0 0 auto;
  color: #a0789a;
}

.reader-identity div {
  min-width: 0;
  display: grid;
  gap: 1px;
}

.reader-identity strong {
  overflow: hidden;
  font-size: calc(13px * var(--font-scale, 1));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.reader-identity span {
  color: var(--muted);
  font-size: calc(8px * var(--font-scale, 1));
}

.journal-filters {
  display: flex;
  gap: 3px;
  padding: 3px;
  border: 1px solid rgba(255,255,255,.7);
  border-radius: 13px;
  background: rgba(239,238,246,.66);
}

.journal-filters button {
  min-height: 29px;
  padding: 0 9px;
  border: 0;
  border-radius: 10px;
  color: #938c9a;
  background: transparent;
  font-size: calc(9px * var(--font-scale, 1));
}

.journal-filters button.active {
  color: #657fa4;
  background: rgba(255,255,255,.88);
  box-shadow: 0 5px 14px rgba(83,77,110,.09);
}

.reader-stage {
  min-height: 0;
  perspective: 1200px;
}

.journal-page {
  position: relative;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  border: 1px solid rgba(204,185,181,.4);
  border-radius: 7px 38px 38px 7px;
  color: #67606f;
  background:
    linear-gradient(90deg,rgba(229,154,188,.23),rgba(229,154,188,.07) 19px,transparent 55px),
    repeating-linear-gradient(180deg,transparent 0,transparent 34px,rgba(137,173,199,.12) 35px,transparent 36px),
    rgba(255,253,249,.95);
  box-shadow:
    12px 24px 55px rgba(75,68,94,.13),
    inset -9px 0 22px rgba(173,151,145,.04);
  transform-origin: left center;
}

.paper-viewport {
  position: absolute;
  z-index: 1;
  inset: 32px 25px 34px 31px;
  overflow: hidden;
}

.page-flow {
  width: var(--journal-column-width);
  height: 100%;
  column-width: var(--journal-column-width);
  column-gap: var(--journal-column-gap);
  column-fill: auto;
  transition: transform .34s cubic-bezier(.22,.74,.3,1);
  will-change: transform;
}

.page-flow.without-transition {
  transition: none;
}

.journal-page.leaving-forward {
  animation: journalLeaveForward .17s cubic-bezier(.55,.06,.68,.19) both;
}

.journal-page.entering-forward {
  animation: journalEnterForward .19s cubic-bezier(.22,.74,.3,1) both;
}

.journal-page.leaving-backward {
  animation: journalLeaveBackward .17s cubic-bezier(.55,.06,.68,.19) both;
}

.journal-page.entering-backward {
  animation: journalEnterBackward .19s cubic-bezier(.22,.74,.3,1) both;
}

@keyframes journalLeaveForward {
  from { opacity: 1; transform: translateX(0) rotateY(0); }
  to { opacity: .12; transform: translateX(-18px) rotateY(-14deg) scale(.985); }
}

@keyframes journalEnterForward {
  from { opacity: .18; transform: translateX(18px) rotateY(11deg) scale(.985); }
  to { opacity: 1; transform: translateX(0) rotateY(0) scale(1); }
}

@keyframes journalLeaveBackward {
  from { opacity: 1; transform: translateX(0) rotateY(0); }
  to { opacity: .12; transform: translateX(18px) rotateY(14deg) scale(.985); }
}

@keyframes journalEnterBackward {
  from { opacity: .18; transform: translateX(-18px) rotateY(-11deg) scale(.985); }
  to { opacity: 1; transform: translateX(0) rotateY(0) scale(1); }
}

.journal-page::before {
  content: "";
  position: absolute;
  inset: 0 auto 0 0;
  width: 7px;
  background: linear-gradient(180deg,rgba(227,142,183,.7),rgba(136,185,223,.58));
}

.journal-page::after {
  content: "“";
  position: absolute;
  z-index: 0;
  top: 82px;
  right: 19px;
  color: rgba(223,166,194,.14);
  font-family: Georgia, serif;
  font-size: calc(88px * var(--font-scale, 1));
  line-height: 1;
  pointer-events: none;
}

.paper-heading {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 13px;
  break-inside: avoid;
}

.paper-heading > div {
  min-width: 0;
}

.paper-heading span {
  display: block;
  margin-bottom: 8px;
  color: #a08fa5;
  font-size: calc(8px * var(--font-scale, 1));
  font-weight: 800;
  letter-spacing: .15em;
}

.paper-heading h1 {
  margin: 0;
  color: #383342;
  font-size: calc(clamp(21px, 6.4vw, 27px) * var(--font-scale, 1));
  line-height: 1.22;
  letter-spacing: -.045em;
}

.paper-heading time {
  flex: 0 0 auto;
  color: #a19aa8;
  font-size: calc(8px * var(--font-scale, 1));
  white-space: nowrap;
}

.journal-content {
  position: relative;
  z-index: 1;
  margin-top: 28px;
  font-size: calc(13px * var(--font-scale, 1));
  line-height: 2.15;
}

.journal-content :deep(> :first-child) { margin-top: 0; }
.journal-content :deep(> :last-child) { margin-bottom: 0; }
.journal-content :deep(p) { margin: 0 0 12px; }
.journal-content :deep(h1),
.journal-content :deep(h2),
.journal-content :deep(h3),
.journal-content :deep(h4) {
  margin: 17px 0 8px;
  color: #3f3a4c;
  line-height: 1.38;
  break-after: avoid;
}
.journal-content :deep(h1) { font-size: calc(18px * var(--font-scale, 1)); }
.journal-content :deep(h2) { font-size: calc(16px * var(--font-scale, 1)); }
.journal-content :deep(h3),
.journal-content :deep(h4) { font-size: calc(14px * var(--font-scale, 1)); }
.journal-content :deep(ul),
.journal-content :deep(ol) { margin: 8px 0 13px; padding-left: 21px; }
.journal-content :deep(blockquote) {
  margin: 11px 0;
  padding: 8px 12px;
  border-left: 3px solid rgba(117,174,224,.48);
  border-radius: 0 9px 9px 0;
  color: #756e80;
  background: rgba(226,239,250,.42);
  break-inside: avoid;
}
.journal-content :deep(pre) {
  max-width: 100%;
  overflow-x: auto;
  padding: 11px 12px;
  border-radius: 10px;
  background: #f5f4f8;
  break-inside: avoid;
}

.journal-content :deep(img) {
  display: block;
  width: 100%;
  max-height: min(310px, 48dvh);
  margin: 15px 0;
  border-radius: 16px;
  object-fit: contain;
  box-shadow: 0 9px 26px rgba(65,60,84,.12);
  break-inside: avoid;
}

.paper-meta {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 20px;
  color: #9b94a1;
  font-size: calc(9px * var(--font-scale, 1));
  break-inside: avoid;
}

.paper-meta span {
  padding: 3px 8px;
  border-radius: 999px;
  color: #6f88ac;
  background: rgba(126,188,239,.13);
}

.paper-meta i {
  font-style: normal;
}

.journal-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 28px;
  color: var(--muted);
  text-align: center;
}

.journal-empty::after {
  content: "";
}

.journal-empty strong {
  margin-top: 5px;
  color: #5e5868;
  font-size: calc(15px * var(--font-scale, 1));
}

.journal-empty p {
  max-width: 230px;
  margin: 0;
  font-size: calc(10px * var(--font-scale, 1));
  line-height: 1.65;
}

.reader-controls {
  display: grid;
  grid-template-columns: 42px 1fr 42px;
  align-items: center;
  gap: 12px;
}

.reader-controls button {
  width: 42px;
  height: 42px;
  border-radius: 50%;
}

.reader-controls button:disabled {
  opacity: .28;
}

.reader-controls div {
  display: grid;
  justify-items: center;
  gap: 2px;
  color: #81798b;
}

.reader-controls strong {
  font-family: Georgia, serif;
  font-size: calc(13px * var(--font-scale, 1));
  font-weight: 500;
}

.reader-controls span {
  color: var(--muted);
  font-size: calc(8px * var(--font-scale, 1));
}

@media (max-width: 370px) {
  .reader-bar {
    grid-template-columns: 40px 1fr;
  }

  .journal-filters {
    grid-column: 1 / -1;
    justify-self: end;
    margin-top: -4px;
  }

  .journal-view {
    gap: 10px;
  }
}
</style>
