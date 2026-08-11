import { App as CapacitorApp } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import type { Router } from "vue-router";

export const PAIRING_DEEP_LINK_EVENT = "aetherx:pairing-deep-link";

let pendingPairingCode = "";

export function normalizePairingDeepLink(value: string) {
  const code = String(value || "").trim();
  return /^aetherx:\/\/complete-pair\?/i.test(code) ? code : "";
}

export function takePendingPairingCode() {
  const code = pendingPairingCode;
  pendingPairingCode = "";
  return code;
}

export async function registerPairingDeepLinks(router: Router) {
  if (!Capacitor.isNativePlatform()) return;

  const open = async (value: string) => {
    const code = normalizePairingDeepLink(value);
    if (!code) return;
    pendingPairingCode = code;
    await router.replace("/login").catch(() => undefined);
    window.dispatchEvent(new CustomEvent(PAIRING_DEEP_LINK_EVENT, { detail: { code } }));
  };

  const launch = await CapacitorApp.getLaunchUrl().catch(() => undefined);
  if (launch?.url) await open(launch.url);
  await CapacitorApp.addListener("appUrlOpen", ({ url }) => void open(url));
}
