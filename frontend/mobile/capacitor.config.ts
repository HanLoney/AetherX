import type { CapacitorConfig } from "@capacitor/cli";

const cloudEdition = process.env.AETHERX_MOBILE_EDITION === "cloud";

const config: CapacitorConfig = {
  appId: cloudEdition
    ? "com.xuanxiaotech.aetherx.online"
    : "com.xuanxiaotech.aetherx.mobile",
  appName: cloudEdition ? "AetherX Online" : "AetherX",
  webDir: "dist",
  server: {
    androidScheme: cloudEdition ? "https" : "http"
  },
  android: {
    allowMixedContent: false,
    backgroundColor: "#f8f7fc"
  }
};

export default config;
