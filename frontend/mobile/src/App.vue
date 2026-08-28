<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import PrimaryNav from "./components/PrimaryNav.vue";
import PrimaryPageDeck from "./components/PrimaryPageDeck.vue";
import { useSessionStore } from "./stores/session";
import { installClientActivityTracking, recordClientEvent, setCurrentClientModule } from "./lib/client-activity";

const session = useSessionStore();
const route = useRoute();
const transitionName = computed(() => String(route.meta.transition || "route-fade"));
const isPrimaryRoute = computed(() => route.meta.primaryNav === true);

let disposeActivity: () => void = () => undefined;
watch(() => route.name || route.path, (value) => setCurrentClientModule(value), { immediate: true });
onMounted(() => {
  disposeActivity = installClientActivityTracking();
  void session.bootstrap().then(() => {
    if (!session.authenticated.value) return;
    void recordClientEvent(session.requireApi(), "app_open", { module: String(route.name || route.path) }).catch(() => undefined);
  });
  window.addEventListener("error", reportWindowError);
  window.addEventListener("unhandledrejection", reportUnhandledRejection);
});
onBeforeUnmount(() => {
  disposeActivity();
  window.removeEventListener("error", reportWindowError);
  window.removeEventListener("unhandledrejection", reportUnhandledRejection);
});

function reportWindowError(event: ErrorEvent) {
  if (!session.authenticated.value) return;
  void recordClientEvent(session.requireApi(), "client_error", { errorCode: event.error?.name || "window_error", module: String(route.name || route.path) }).catch(() => undefined);
}

function reportUnhandledRejection(event: PromiseRejectionEvent) {
  if (!session.authenticated.value) return;
  const reason = event.reason as { name?: string } | undefined;
  void recordClientEvent(session.requireApi(), "client_error", { errorCode: reason?.name || "unhandled_rejection", module: String(route.name || route.path) }).catch(() => undefined);
}
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
