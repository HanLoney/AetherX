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

export interface StoredSession {
  token: string;
  user: { id: string; username: string; displayName: string };
}

export async function saveServerUrl(serverUrl: string) {
  await Preferences.set({ key: SERVER_KEY, value: serverUrl });
}

export async function loadServerUrl() {
  return (await Preferences.get({ key: SERVER_KEY })).value || import.meta.env.VITE_AETHERX_SERVER_URL || "http://127.0.0.1:4318";
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
