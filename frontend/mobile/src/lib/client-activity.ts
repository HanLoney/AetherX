import type { AetherApi } from "./api";
import { loadInstallationId } from "./storage";

let currentModule = "app";
let lastInteractionAt = Date.now();
let installed = false;

export function installClientActivityTracking() {
  if (installed) return () => undefined;
  installed = true;
  const mark = () => { lastInteractionAt = Date.now(); };
  window.addEventListener("pointerdown", mark, { passive: true });
  window.addEventListener("keydown", mark, { passive: true });
  return () => {
    installed = false;
    window.removeEventListener("pointerdown", mark);
    window.removeEventListener("keydown", mark);
  };
}

export function setCurrentClientModule(value: unknown) {
  currentModule = String(value || "app").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").slice(0, 48) || "app";
}

export function clientActivitySnapshot() {
  return { currentModule, lastInteractionAt };
}

export async function recordClientEvent(
  api: AetherApi,
  eventName: string,
  properties: Record<string, unknown> = {},
  traceId = ""
) {
  const installationId = await loadInstallationId();
  const clientSessionId = sessionStorage.getItem("aetherx-analytics-session") || createSessionId();
  return api.analyticsEvents([{
    id: crypto.randomUUID(),
    installationId,
    clientSessionId,
    eventName,
    traceId,
    properties,
    occurredAt: Date.now()
  }]);
}

function createSessionId() {
  const id = `mobile-session-${crypto.randomUUID()}`;
  sessionStorage.setItem("aetherx-analytics-session", id);
  return id;
}
