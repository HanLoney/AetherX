<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink } from "vue-router";
import { Home, MessageCircle, CalendarDays, BrainCircuit, SlidersHorizontal } from "@lucide/vue";
import { useDataStore } from "../stores/data";

defineProps<{ title: string; kicker?: string; quiet?: boolean }>();
const data = useDataStore();

const items = [
  { to: "/home", label: "主页", icon: Home },
  { to: "/chat", label: "聊天", icon: MessageCircle },
  { to: "/todos", label: "待办", icon: CalendarDays },
  { to: "/memories", label: "记忆", icon: BrainCircuit },
  { to: "/settings", label: "设置", icon: SlidersHorizontal }
];

onMounted(async () => {
  if (!data.lastUpdatedAt.value) await data.refreshAll().catch(() => undefined);
  await data.startSync();
});
</script>

<template>
  <div class="mobile-shell" :class="{ quiet }">
    <div class="ambient ambient-pink" />
    <div class="ambient ambient-blue" />
    <header class="page-header">
      <div>
        <span v-if="kicker" class="eyebrow">{{ kicker }}</span>
        <h1>{{ title }}</h1>
      </div>
      <slot name="header" />
    </header>
    <main class="page-content"><slot /></main>
    <nav class="floating-nav" aria-label="主要导航">
      <RouterLink v-for="item in items" :key="item.to" :to="item.to" :aria-label="item.label">
        <component :is="item.icon" :size="20" :stroke-width="1.8" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>
