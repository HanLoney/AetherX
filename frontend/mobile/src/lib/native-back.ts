import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { Router } from "vue-router";

export const NATIVE_BACK_EVENT = "aetherx:native-back";

export function resolveNativeBackAction(
  path: string,
  canGoBack: boolean
): "back" | "home" | "exit" {
  if (path === "/home" || path === "/login") return "exit";
  return canGoBack ? "back" : "home";
}

export async function registerNativeBackNavigation(router: Router) {
  if (!Capacitor.isNativePlatform()) return;

  await CapacitorApp.addListener("backButton", ({ canGoBack }) => {
    const overlayEvent = new Event(NATIVE_BACK_EVENT, { cancelable: true });
    window.dispatchEvent(overlayEvent);
    if (overlayEvent.defaultPrevented) return;

    const action = resolveNativeBackAction(router.currentRoute.value.path, canGoBack);
    if (action === "back") {
      router.back();
      return;
    }
    if (action === "home") {
      void router.replace("/home");
      return;
    }
    void CapacitorApp.exitApp();
  });
}
