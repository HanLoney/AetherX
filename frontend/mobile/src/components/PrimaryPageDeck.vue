<script setup lang="ts">
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { primaryRoutePaths } from "../router";

const route = useRoute();
const router = useRouter();
const pages = [
  defineAsyncComponent(() => import("../views/HomeView.vue")),
  defineAsyncComponent(() => import("../views/TodosView.vue")),
  defineAsyncComponent(() => import("../views/MemoriesView.vue")),
  defineAsyncComponent(() => import("../views/SettingsView.vue"))
];

const currentIndex = computed(() => typeof route.meta.navIndex === "number" ? route.meta.navIndex : 0);
const visualIndex = ref(currentIndex.value);
const dragging = ref(false);
const dragX = ref(0);
let active = false;
let axis: "" | "horizontal" | "vertical" = "";
let startX = 0;
let startY = 0;
let lastX = 0;
let lastAt = 0;
let velocityX = 0;

const trackStyle = computed<Record<string, string>>(() => ({
  "--deck-offset": `calc(${-visualIndex.value * 100}% + ${dragX.value}px)`
}));

watch(currentIndex, (index) => {
  if (!dragging.value) visualIndex.value = index;
});

function isSwipeControl(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest(
    "input, textarea, select, [contenteditable='true'], [role='slider'], [data-page-swipe='ignore']"
  ));
}

function handleTouchStart(event: TouchEvent) {
  active = false;
  axis = "";
  velocityX = 0;
  if (event.touches.length !== 1 || isSwipeControl(event.target)) return;
  const touch = event.touches.item(0);
  if (!touch) return;
  active = true;
  startX = lastX = touch.clientX;
  startY = touch.clientY;
  lastAt = performance.now();
}

function handleTouchMove(event: TouchEvent) {
  if (!active) return;
  const touch = event.touches.item(0);
  if (!touch) return;
  const deltaX = touch.clientX - startX;
  const deltaY = touch.clientY - startY;

  if (!axis && Math.max(Math.abs(deltaX), Math.abs(deltaY)) > 8) {
    axis = Math.abs(deltaX) > Math.abs(deltaY) * 1.08 ? "horizontal" : "vertical";
    if (axis === "horizontal") dragging.value = true;
  }
  if (axis !== "horizontal") return;

  event.preventDefault();
  const now = performance.now();
  const elapsed = Math.max(1, now - lastAt);
  velocityX = (touch.clientX - lastX) / elapsed;
  lastX = touch.clientX;
  lastAt = now;

  const atStart = visualIndex.value === 0 && deltaX > 0;
  const atEnd = visualIndex.value === pages.length - 1 && deltaX < 0;
  dragX.value = (atStart || atEnd) ? deltaX * .24 : deltaX;
}

function settle(targetIndex: number) {
  dragging.value = false;
  dragX.value = 0;
  visualIndex.value = targetIndex;
  const target = primaryRoutePaths[targetIndex];
  if (target && target !== route.path) void router.push(target);
}

function handleTouchEnd(event: TouchEvent) {
  if (!active) return;
  active = false;
  const touch = event.changedTouches.item(0);
  if (!touch || axis !== "horizontal") {
    settle(currentIndex.value);
    return;
  }

  const deltaX = touch.clientX - startX;
  const threshold = Math.min(96, window.innerWidth * .2);
  const shouldChange = Math.abs(deltaX) >= threshold || Math.abs(velocityX) >= .52;
  const direction = deltaX < 0 ? 1 : -1;
  const targetIndex = shouldChange
    ? Math.max(0, Math.min(pages.length - 1, currentIndex.value + direction))
    : currentIndex.value;
  settle(targetIndex);
}

function handleTouchCancel() {
  active = false;
  settle(currentIndex.value);
}
</script>

<template>
  <section
    class="primary-page-deck"
    :class="{ 'is-dragging': dragging }"
    @touchstart.passive="handleTouchStart"
    @touchmove="handleTouchMove"
    @touchend="handleTouchEnd"
    @touchcancel="handleTouchCancel"
  >
    <div class="primary-page-track" :style="trackStyle">
      <div
        v-for="(page, index) in pages"
        :key="primaryRoutePaths[index]"
        class="primary-deck-page"
        :class="{ 'is-current': index === currentIndex }"
        :style="{ left: `${index * 100}%` }"
        :inert="index !== currentIndex"
        :aria-hidden="index !== currentIndex"
      >
        <component :is="page" />
      </div>
    </div>
  </section>
</template>
