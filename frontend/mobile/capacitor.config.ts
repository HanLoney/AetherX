import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.xuanxiaotech.aetherx.mobile",
  appName: "AetherX",
  webDir: "dist",
  server: {
    androidScheme: "http"
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#f8f7fc"
  }
};

export default config;
