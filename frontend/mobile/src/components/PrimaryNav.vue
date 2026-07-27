<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, useRoute } from "vue-router";
import {
  BrainCircuit,
  CalendarDays,
  CircleUserRound,
  Home,
} from "@lucide/vue";
import { usePrimaryNavigation } from "../lib/primary-navigation";
import { useModuleStore } from "../stores/modules";

const route = useRoute();
const { hidden } = usePrimaryNavigation();

const modules = useModuleStore();
const allItems = [
  { to: "/home", label: "主页", icon: Home },
  { to: "/todos", label: "待办", icon: CalendarDays, module: "todo" },
  { to: "/memories", label: "记忆", icon: BrainCircuit, module: "memory" },
  { to: "/settings", label: "我的", icon: CircleUserRound }
];
const items = computed(() => allItems.filter((item) => !item.module || modules.isEnabled(item.module)));

const visible = computed(() => route.meta.primaryNav === true);
const activeIndex = computed(() => {
  const index = items.value.findIndex((item) => item.to === route.path);
  return index < 0 ? 0 : index;
});
</script>

<template>
  <Transition name="primary-nav-visibility">
    <nav
      v-if="visible"
      class="floating-nav"
      :class="{ 'is-hidden': hidden }"
      :style="{ '--nav-index': activeIndex, '--nav-count': items.length }"
      aria-label="主要导航"
    >
      <div class="nav-active-pill" aria-hidden="true">
        <i :key="route.path" />
      </div>
      <RouterLink v-for="item in items" :key="item.to" :to="item.to" :aria-label="item.label">
        <component :is="item.icon" :size="20" :stroke-width="1.8" />
        <span>{{ item.label }}</span>
      </RouterLink>
    </nav>
  </Transition>
</template>
