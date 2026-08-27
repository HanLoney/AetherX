import { computed, readonly, ref } from "vue";
import type { ModuleState } from "../lib/api";
import { useSessionStore } from "./session";

const modules = ref<ModuleState[]>([]);
const loading = ref(false);
const error = ref("");
let scope = "";
let loadPromise: Promise<ModuleState[]> | null = null;

function currentScope() {
  const session = useSessionStore();
  return `${session.spaceId.value || session.serverUrl.value}|${session.user.value?.id || session.user.value?.email || session.user.value?.username || ""}`;
}

async function hydrate(force = false) {
  const nextScope = currentScope();
  if (!force && modules.value.length && scope === nextScope) return modules.value;
  if (loadPromise) return loadPromise;
  loading.value = true;
  error.value = "";
  loadPromise = useSessionStore().requireApi().listModules()
    .then((snapshot) => {
      modules.value = snapshot;
      scope = nextScope;
      window.dispatchEvent(new CustomEvent("aetherx:modules-changed", { detail: snapshot }));
      return snapshot;
    })
    .catch((cause) => {
      error.value = cause instanceof Error ? cause.message : "模块状态读取失败。";
      throw cause;
    })
    .finally(() => {
      loading.value = false;
      loadPromise = null;
    });
  return loadPromise;
}

function isEnabled(id: string) {
  const module = modules.value.find((item) => item.id === id);
  return module ? module.enabled : true;
}

async function setEnabled(id: string, enabled: boolean) {
  loading.value = true;
  error.value = "";
  try {
    modules.value = await useSessionStore().requireApi().updateModule(id, enabled);
    window.dispatchEvent(new CustomEvent("aetherx:modules-changed", { detail: modules.value }));
    return modules.value;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "模块状态保存失败。";
    throw cause;
  } finally {
    loading.value = false;
  }
}

function reset() {
  modules.value = [];
  scope = "";
  error.value = "";
  loadPromise = null;
}

window.addEventListener("aetherx:session-invalidated", reset);
window.addEventListener("aetherx:hub-routed", reset);

export function useModuleStore() {
  return {
    modules: readonly(modules),
    loading: readonly(loading),
    error: readonly(error),
    enabledCount: computed(() => modules.value.filter((module) => module.enabled).length),
    hydrate,
    isEnabled,
    setEnabled,
    reset
  };
}
