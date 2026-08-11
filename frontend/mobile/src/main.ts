import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { initializeInterfaceSettings } from "./lib/interface-settings";
import { registerNativeBackNavigation } from "./lib/native-back";
import { initializeLocalHub } from "./lib/local-hub";
import { registerPairingDeepLinks } from "./lib/pairing-deep-link";
import "./styles/tokens.css";
import "./styles/base.css";

void Promise.all([
  initializeInterfaceSettings().catch(() => undefined),
  initializeLocalHub().catch(() => undefined)
]).finally(() => {
  createApp(App).use(router).mount("#app");
  void router.isReady().then(() => Promise.all([
    registerNativeBackNavigation(router),
    registerPairingDeepLinks(router)
  ]));
});
