import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const loginView = readFileSync(new URL("../views/LoginView.vue", import.meta.url), "utf8");
const sessionStore = readFileSync(new URL("../stores/session.ts", import.meta.url), "utf8");
const apiClient = readFileSync(new URL("./api.ts", import.meta.url), "utf8");
const storage = readFileSync(new URL("./storage.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.ts", import.meta.url), "utf8");
const settingsView = readFileSync(new URL("../views/SettingsView.vue", import.meta.url), "utf8");
const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const capacitorConfig = readFileSync(new URL("../../capacitor.config.ts", import.meta.url), "utf8");
const androidBuild = readFileSync(new URL("../../android/app/build.gradle", import.meta.url), "utf8");
const mainActivity = readFileSync(new URL("../../android/app/src/main/java/com/xuanxiaotech/aetherx/mobile/MainActivity.java", import.meta.url), "utf8");
const cloudManifest = readFileSync(new URL("../../android/app/src/cloud/AndroidManifest.xml", import.meta.url), "utf8");
const cloudNetworkSecurity = readFileSync(new URL("../../android/app/src/cloud/res/xml/network_security_config.xml", import.meta.url), "utf8");
const cloudEnvironment = readFileSync(new URL("../../.env.cloud", import.meta.url), "utf8");

describe("AetherX Online mobile authentication", () => {
  it("has an explicit Cloud build entry", () => {
    expect(packageJson.scripts["dev:cloud"]).toBe("vite --mode cloud");
    expect(packageJson.scripts["build:cloud"]).toContain("vite build --mode cloud");
    expect(packageJson.scripts["android:sync:cloud"]).toContain("sync-android.mjs cloud");
    expect(packageJson.scripts["android:cloud:release"]).toContain("assembleCloudRelease");
  });

  it("uses an independent Android identity, signing profile and HTTPS-only native runtime", () => {
    expect(capacitorConfig).toContain('"com.xuanxiaotech.aetherx.online"');
    expect(capacitorConfig).toContain('cloudEdition ? "AetherX Online" : "AetherX"');
    expect(androidBuild).toContain('applicationId "com.xuanxiaotech.aetherx.online"');
    expect(androidBuild).toContain('AETHERX_CLOUD_ANDROID_KEYSTORE');
    expect(androidBuild).toContain('aetherxDeepLinkScheme: "aetherx-online"');
    expect(mainActivity).toContain("if (BuildConfig.CLOUD_EDITION) return;");
    expect(mainActivity).toContain("if (!BuildConfig.CLOUD_EDITION) registerPlugin(LocalHubPlugin.class);");
    expect(cloudManifest).toContain('android:name=".hub.LocalHubForegroundService"');
    expect(cloudManifest).toContain('android:name=".hub.LocalHubBootReceiver"');
    expect(cloudManifest.match(/tools:node="remove"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(cloudNetworkSecurity).toContain('cleartextTrafficPermitted="false"');
    expect(cloudNetworkSecurity).not.toContain("domain-config");
    expect(cloudEnvironment).toContain("VITE_AETHERX_SERVER_URL=https://api.aetherx.tech");
  });

  it("reuses the existing login view for email registration and verification", () => {
    expect(loginView).toContain('VITE_AETHERX_EDITION === "cloud"');
    expect(loginView).toContain('loginIdentifier === "email"');
    expect(loginView).toContain("session.verifyEmail");
    expect(loginView).toContain("session.resendEmailVerification");
    expect(loginView).toContain("returnToEmailLogin");
    expect(loginView).toContain("如果邮箱已经注册，请直接返回登录");
    expect(loginView).toContain("await session.login");
    expect(sessionStore).toContain("clearError");
    expect(loginView).toContain("session.requestPasswordReset");
    expect(loginView).toContain("session.resetPassword");
    expect(loginView).toContain("验证你的邮箱");
    expect(loginView).toContain("找回登录密码");
  });

  it("keeps cloud sessions out of the Local Hub routing path", () => {
    expect(sessionStore).toContain("if (authenticatedUser.email)");
    expect(sessionStore).toContain("await clearHubRouting()");
    expect(sessionStore).toContain("if (stored?.token && stored.user.email)");
    expect(main).toContain('VITE_AETHERX_EDITION === "cloud"');
    expect(main).toContain("await import(\"./lib/local-hub\")");
    expect(settingsView).toContain("v-if=\"!cloudEdition\"");
    expect(settingsView).toContain("AetherX 云端服务");
    expect(settingsView).toContain("if (cloudEdition.value) return;");
    expect(settingsView).toContain("archiveIncludeProviderKeys");
    expect(settingsView).toContain('"password_encrypted" : "excluded"');
  });

  it("keeps email as a first-class identity instead of a fake username", () => {
    expect(apiClient).toContain("email?: string");
    expect(apiClient).toContain('"/api/v1/auth/email/verify"');
    expect(storage).toContain("email?: string");
    expect(storage).toContain("username?: string");
    expect(storage).toContain("if (CLOUD_EDITION) return requiredCloudServerUrl()");
  });

  it("refreshes cloud login silently without exposing device management", () => {
    expect(apiClient).toContain('"/api/v1/auth/refresh"');
    expect(apiClient).toContain("refreshToken?: string");
    expect(sessionStore).toContain("sessionRefreshToken");
    expect(storage).toContain("refreshToken?: string");
    expect(settingsView).not.toContain("authSessions");
    expect(settingsView).not.toContain("设备会话");
  });
});
