import { createRouter, createWebHashHistory } from "vue-router";
import { useSessionStore } from "./stores/session";
import { useModuleStore } from "./stores/modules";

export const primaryRoutePaths = ["/home", "/todos", "/memories", "/settings"] as const;

export function availablePrimaryRoutePaths() {
  const modules = useModuleStore();
  return primaryRoutePaths.filter((path) =>
    path === "/todos"
      ? modules.isEnabled("todo")
      : path === "/memories"
        ? modules.isEnabled("memory")
        : true
  );
}

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/home" },
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/home", name: "home", component: () => import("./views/HomeView.vue"), meta: { primaryNav: true, navIndex: 0 } },
    { path: "/chat", name: "chat", component: () => import("./views/ChatView.vue") },
    { path: "/journals", name: "journals", component: () => import("./views/JournalsView.vue"), meta: { module: "autonomous-journal" } },
    { path: "/gallery", name: "gallery", component: () => import("./views/GalleryView.vue") },
    { path: "/todos", name: "todos", component: () => import("./views/TodosView.vue"), meta: { primaryNav: true, navIndex: 1, module: "todo" } },
    { path: "/memories", name: "memories", component: () => import("./views/MemoriesView.vue"), meta: { primaryNav: true, navIndex: 2, module: "memory" } },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue"), meta: { primaryNav: true, navIndex: 3 } }
  ]
});

router.beforeEach(async (to, from) => {
  const session = useSessionStore();
  await session.bootstrap();
  if (!to.meta.public && !session.authenticated.value) return "/login";
  if (to.path === "/login" && session.authenticated.value) return "/home";
  if (session.authenticated.value) {
    const modules = useModuleStore();
    await modules.hydrate().catch(() => undefined);
    if (typeof to.meta.module === "string" && !modules.isEnabled(to.meta.module)) {
      return "/home";
    }
  }
  const paths = availablePrimaryRoutePaths();
  const toIndex = paths.indexOf(to.path as (typeof paths)[number]);
  const fromIndex = paths.indexOf(from.path as (typeof paths)[number]);
  to.meta.transition = toIndex >= 0 && fromIndex >= 0 && toIndex !== fromIndex
    ? toIndex > fromIndex ? "primary-forward" : "primary-backward"
    : "route-fade";
});

window.addEventListener("aetherx:modules-changed", () => {
  const moduleId = router.currentRoute.value.meta.module;
  if (typeof moduleId === "string" && !useModuleStore().isEnabled(moduleId)) {
    void router.replace("/home");
  }
});
