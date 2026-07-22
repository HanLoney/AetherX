<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { ArrowLeft } from "@lucide/vue";
import { usePrimaryNavigation } from "../lib/primary-navigation";
import { ensureMobileDataStarted } from "../lib/mobile-data-bootstrap";

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

const { hidden: navHidden, setHidden: setNavHidden } = usePrimaryNavigation();
const pageContent = ref<HTMLElement | null>(null);
const headerCompact = ref(false);
const keyboardOpen = ref(false);
let lastScrollTop = 0;
let focusTimer: ReturnType<typeof setTimeout> | undefined;

function handlePageScroll() {
  if (props.layout !== "browse") return;
  const scrollTop = pageContent.value?.scrollTop || 0;
  headerCompact.value = scrollTop > 18;
  if (scrollTop < 24 || scrollTop < lastScrollTop - 4) setNavHidden(false);
  else if (scrollTop > 72 && scrollTop > lastScrollTop + 4) setNavHidden(true);
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
    setNavHidden(true);
  }
}

function handleFocusOut() {
  if (focusTimer) clearTimeout(focusTimer);
  focusTimer = setTimeout(() => {
    keyboardOpen.value = isTextControl(document.activeElement);
    if (!keyboardOpen.value) setNavHidden(false);
  }, 0);
}

onMounted(() => ensureMobileDataStarted());

onBeforeUnmount(() => {
  if (focusTimer) clearTimeout(focusTimer);
  setNavHidden(false);
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

  </div>
</template>
