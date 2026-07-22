import { createRouter, createWebHashHistory } from "vue-router";
import { useSessionStore } from "./stores/session";

export const primaryRoutePaths = ["/home", "/todos", "/memories", "/settings"] as const;

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/home" },
    { path: "/login", name: "login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/home", name: "home", component: () => import("./views/HomeView.vue"), meta: { primaryNav: true, navIndex: 0 } },
    { path: "/chat", name: "chat", component: () => import("./views/ChatView.vue") },
    { path: "/journals", name: "journals", component: () => import("./views/JournalsView.vue") },
    { path: "/gallery", name: "gallery", component: () => import("./views/GalleryView.vue") },
    { path: "/todos", name: "todos", component: () => import("./views/TodosView.vue"), meta: { primaryNav: true, navIndex: 1 } },
    { path: "/memories", name: "memories", component: () => import("./views/MemoriesView.vue"), meta: { primaryNav: true, navIndex: 2 } },
    { path: "/settings", name: "settings", component: () => import("./views/SettingsView.vue"), meta: { primaryNav: true, navIndex: 3 } }
  ]
});

router.beforeEach(async (to, from) => {
  const toIndex = typeof to.meta.navIndex === "number" ? to.meta.navIndex : undefined;
  const fromIndex = typeof from.meta.navIndex === "number" ? from.meta.navIndex : undefined;
  if (toIndex !== undefined && fromIndex !== undefined && toIndex !== fromIndex) {
    to.meta.transition = toIndex > fromIndex ? "primary-forward" : "primary-backward";
  } else {
    to.meta.transition = "route-fade";
  }

  const session = useSessionStore();
  await session.bootstrap();
  if (!to.meta.public && !session.authenticated.value) return "/login";
  if (to.path === "/login" && session.authenticated.value) return "/home";
});
