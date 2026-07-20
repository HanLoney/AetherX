import { createApp } from "vue";
import App from "./App.vue";
import { router } from "./router";
import { registerNativeBackNavigation } from "./lib/native-back";
import "./styles/tokens.css";
import "./styles/base.css";

createApp(App).use(router).mount("#app");
void router.isReady().then(() => registerNativeBackNavigation(router));
