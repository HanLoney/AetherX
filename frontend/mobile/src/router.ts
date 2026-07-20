import { createRouter, createWebHashHistory } from "vue-router";
import { useSessionStore } from "./stores/session";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", redirect: "/home" },
    { path: "/login", component: () => import("./views/LoginView.vue"), meta: { public: true } },
    { path: "/home", component: () => import("./views/HomeView.vue") },
    { path: "/chat", component: () => import("./views/ChatView.vue") },
    { path: "/journals", component: () => import("./views/JournalsView.vue") },
    { path: "/todos", component: () => import("./views/TodosView.vue") },
    { path: "/memories", component: () => import("./views/MemoriesView.vue") },
    { path: "/settings", component: () => import("./views/SettingsView.vue") }
  ]
});

router.beforeEach(async (to) => {
  const session = useSessionStore();
  await session.bootstrap();
  if (!to.meta.public && !session.authenticated.value) return "/login";
  if (to.path === "/login" && session.authenticated.value) return "/home";
});
