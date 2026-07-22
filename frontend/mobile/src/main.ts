import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { initializeInterfaceSettings } from "./lib/interface-settings";
import { registerNativeBackNavigation } from "./lib/native-back";
import "./styles/tokens.css";
import "./styles/base.css";

void initializeInterfaceSettings().catch(() => undefined).finally(() => {
  createApp(App).use(router).mount("#app");
  void router.isReady().then(() => registerNativeBackNavigation(router));
});
