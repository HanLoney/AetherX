import { Capacitor, registerPlugin } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

interface SecureSessionPlugin {
  set(options: { key: string; value: string }): Promise<void>;
  get(options: { key: string }): Promise<{ value: string | null }>;
  remove(options: { key: string }): Promise<void>;
}

const SecureSession = registerPlugin<SecureSessionPlugin>("SecureSession");
const SESSION_KEY = "aetherx.session";
const SERVER_KEY = "aetherx.server";
const CURSOR_KEY = "aetherx.sync.cursor";
const INSTALLATION_KEY = "aetherx.mobile.installation";
const HUB_ROUTING_KEY = "aetherx.hub.routing";
const CLOUD_EDITION = import.meta.env.VITE_AETHERX_EDITION === "cloud";
const BUILT_IN_SERVER_URL = String(import.meta.env.VITE_AETHERX_SERVER_URL || "").replace(/\/+$/, "");

export interface StoredSession {
  token: string;
  refreshToken?: string;
  user: {
    id: string;
    username?: string;
    email?: string;
    emailVerified?: boolean;
    displayName: string;
  };
}

export interface StoredHubNode {
  nodeId: string;
  serverUrl: string;
  token: string;
  lastSeenAt: number;
}

export interface StoredHubRouting {
  spaceId: string;
  activeNodeId: string;
  localNodeId: string;
  epoch: number;
  nodes: StoredHubNode[];
}

export async function saveServerUrl(serverUrl: string) {
  await Preferences.set({
    key: SERVER_KEY,
    value: CLOUD_EDITION ? requiredCloudServerUrl() : serverUrl
  });
}

export async function loadServerUrl() {
  if (CLOUD_EDITION) return requiredCloudServerUrl();
  return (await Preferences.get({ key: SERVER_KEY })).value || import.meta.env.VITE_AETHERX_SERVER_URL || "http://127.0.0.1:4318";
}

function requiredCloudServerUrl() {
  if (!/^https:\/\/[^/]+/i.test(BUILT_IN_SERVER_URL)) {
    throw new Error("AetherX Online 构建缺少固定的 HTTPS 服务地址。");
  }
  return BUILT_IN_SERVER_URL;
}

export async function saveSession(session: StoredSession) {
  const value = JSON.stringify(session);
  if (Capacitor.getPlatform() === "android") {
    await SecureSession.set({ key: SESSION_KEY, value });
  } else {
    sessionStorage.setItem(SESSION_KEY, value);
  }
}

export async function loadSession(): Promise<StoredSession | null> {
  try {
    const value = Capacitor.getPlatform() === "android"
      ? (await SecureSession.get({ key: SESSION_KEY })).value
      : sessionStorage.getItem(SESSION_KEY);
    return value ? JSON.parse(value) as StoredSession : null;
  } catch {
    return null;
  }
}

export async function clearSession() {
  if (Capacitor.getPlatform() === "android") {
    await SecureSession.remove({ key: SESSION_KEY });
  } else {
    sessionStorage.removeItem(SESSION_KEY);
  }
}

export async function saveHubRouting(routing: StoredHubRouting) {
  const value = JSON.stringify(routing);
  if (Capacitor.getPlatform() === "android") {
    await SecureSession.set({ key: HUB_ROUTING_KEY, value });
  } else {
    sessionStorage.setItem(HUB_ROUTING_KEY, value);
  }
}

export async function loadHubRouting(): Promise<StoredHubRouting | null> {
  try {
    const value = Capacitor.getPlatform() === "android"
      ? (await SecureSession.get({ key: HUB_ROUTING_KEY })).value
      : sessionStorage.getItem(HUB_ROUTING_KEY);
    if (!value) return null;
    const parsed = JSON.parse(value) as StoredHubRouting;
    if (!parsed.spaceId || !Array.isArray(parsed.nodes)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function clearHubRouting() {
  if (Capacitor.getPlatform() === "android") {
    await SecureSession.remove({ key: HUB_ROUTING_KEY });
  } else {
    sessionStorage.removeItem(HUB_ROUTING_KEY);
  }
}

export function syncCursorKey(scope: string) {
  const normalized = String(scope || "default").trim().toLocaleLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${CURSOR_KEY}.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function loadSyncCursor(scope = "default") {
  const value = Number((await Preferences.get({ key: syncCursorKey(scope) })).value || 0);
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export async function saveSyncCursor(scope: string, cursor: number) {
  await Preferences.set({ key: syncCursorKey(scope), value: String(cursor) });
}

export async function clearSyncCursor(scope = "default") {
  await Preferences.remove({ key: syncCursorKey(scope) });
}

export async function loadInstallationId() {
  const stored = (await Preferences.get({ key: INSTALLATION_KEY })).value;
  if (stored) return stored;
  const created = crypto.randomUUID();
  await Preferences.set({ key: INSTALLATION_KEY, value: created });
  return created;
}
