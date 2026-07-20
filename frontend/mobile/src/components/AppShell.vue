<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import {
  ArrowLeft,
  BrainCircuit,
  CalendarDays,
  Home,
  SlidersHorizontal
} from "@lucide/vue";
import { useDataStore } from "../stores/data";

const props = withDefaults(defineProps<{
  title: string;
  kicker?: string;
  quiet?: boolean;
  layout?: "browse" | "focus";
  backTo?: string;
  headerless?: boolean;
}>(), {
  layout: "browse",
  backTo: "/home"
});

const data = useDataStore();
const pageContent = ref<HTMLElement | null>(null);
const headerCompact = ref(false);
const navHidden = ref(false);
const keyboardOpen = ref(false);
let lastScrollTop = 0;
let focusTimer: ReturnType<typeof setTimeout> | undefined;

const items = [
  { to: "/home", label: "主页", icon: Home },
  { to: "/todos", label: "待办", icon: CalendarDays },
  { to: "/memories", label: "记忆", icon: BrainCircuit },
  { to: "/settings", label: "设置", icon: SlidersHorizontal }
];

function handlePageScroll() {
  if (props.layout !== "browse") return;
  const scrollTop = pageContent.value?.scrollTop || 0;
  headerCompact.value = scrollTop > 18;
  if (scrollTop < 24 || scrollTop < lastScrollTop - 4) navHidden.value = false;
  else if (scrollTop > 72 && scrollTop > lastScrollTop + 4) navHidden.value = true;
  lastScrollTop = scrollTop;
}

function isTextControl(target: EventTarget | null) {
  return target instanceof HTMLElement &&
    target.matches("input, textarea, [contenteditable='true']");
}

function handleFocusIn(event: FocusEvent) {
  if (focusTimer) clearTimeout(focusTimer);
  if (isTextControl(event.target)) {
    keyboardOpen.value = true;
    navHidden.value = true;
  }
}

function handleFocusOut() {
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    keyboardOpen.value = isTextControl(document.activeElement);
    if (!keyboardOpen.value) navHidden.value = false;
  }, 0);
}

onMounted(async () => {
  if (!data.lastUpdatedAt.value) await data.refreshAll().catch(() => undefined);
  await data.startSync();
});

onBeforeUnmount(() => {
  if (focusTimer) clearTimeout(focusTimer);
});
</script>

<template>
  <div
    class="mobile-shell"
    :class="[
      `layout-${props.layout}`,
      {
        quiet,
        headerless,
        'header-compact': headerCompact,
        'nav-hidden': navHidden,
        'keyboard-open': keyboardOpen
      }
    ]"
    @focusin="handleFocusIn"
    @focusout="handleFocusOut"
  >
    <div class="ambient ambient-pink" />
    <div class="ambient ambient-blue" />

    <header v-if="!props.headerless" class="page-header">
      <RouterLink
        v-if="props.layout === 'focus'"
        class="icon-button focus-back-button"
        :to="props.backTo"
        aria-label="返回主页"
      >
        <ArrowLeft :size="19" />
      </RouterLink>
      <div class="page-title">
        <span v-if="kicker" class="eyebrow">{{ kicker }}</span>
        <h1>{{ title }}</h1>
      </div>
      <div class="page-header-actions">
        <slot name="header" />
      </div>
    </header>

    <main ref="pageContent" class="page-content" @scroll.passive="handlePageScroll">
      <slot />
    </main>

    <div v-if="$slots['bottom-dock']" class="bottom-dock">
      <slot name="bottom-dock" />
    </div>

    <nav v-if="props.layout === 'browse'" class="floating-nav" aria-label="主要导航">
      <RouterLink v-for="item in items" :key="item.to" :to="item.to" :aria-label="item.label">
        <component :is="item.icon" :size="20" :stroke-width="1.8" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
