<script setup lang="ts">
import { computed, onMounted } from "vue";
import { RouterView, useRoute } from "vue-router";
import PrimaryNav from "./components/PrimaryNav.vue";
import PrimaryPageDeck from "./components/PrimaryPageDeck.vue";
import { useSessionStore } from "./stores/session";

const session = useSessionStore();
const route = useRoute();
const transitionName = computed(() => String(route.meta.transition || "route-fade"));
const isPrimaryRoute = computed(() => route.meta.primaryNav === true);

onMounted(() => session.bootstrap());
</script>

<template>
  <div class="app-route-stage">
    <PrimaryPageDeck v-if="isPrimaryRoute" />
    <RouterView v-else v-slot="{ Component, route: renderedRoute }">
      <Transition :name="transitionName">
        <component :is="Component" :key="renderedRoute.name || renderedRoute.path" />
      </Transition>
    </RouterView>
  </div>
  <PrimaryNav />
</template>
