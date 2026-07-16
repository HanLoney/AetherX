import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.xuanxiaotech.aetherx.mobile",
  appName: "AetherX",
  webDir: "dist",
  android: {
    allowMixedContent: true,
    backgroundColor: "#f8f7fc"
  }
};

export default config;
