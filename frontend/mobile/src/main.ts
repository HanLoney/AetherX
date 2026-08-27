import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { initializeInterfaceSettings } from "./lib/interface-settings";
import { registerNativeBackNavigation } from "./lib/native-back";
import "./styles/tokens.css";
import "./styles/base.css";

void Promise.all([
  initializeInterfaceSettings().catch(() => undefined),
  initializeEditionRuntime().catch(() => undefined)
]).finally(() => {
  createApp(App).use(router).mount("#app");
  void router.isReady().then(async () => {
    await registerNativeBackNavigation(router);
    if (import.meta.env.VITE_AETHERX_EDITION !== "cloud") {
      const { registerPairingDeepLinks } = await import("./lib/pairing-deep-link");
      await registerPairingDeepLinks(router);
    }
  });
});

async function initializeEditionRuntime() {
  if (import.meta.env.VITE_AETHERX_EDITION === "cloud") return;
  const { initializeLocalHub } = await import("./lib/local-hub");
  await initializeLocalHub();
}
