import type { AetherApi, Journal } from "./api";
import { hydrateMediaSources } from "./api";

const DATABASE_NAME = "aetherx-journal-cache";
const STORE_NAME = "journal-snapshots";
const VERSION = 1;
const memoryCache = new Map<string, CachedJournals>();

export interface CachedJournals {
  scope: string;
  journals: Journal[];
  savedAt: number;
}

function normalizedScope(scope: string) {
  return String(scope || "").trim().toLocaleLowerCase();
}

function cloneForStorage<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "scope" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function databaseRequest<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
) {
  if (typeof indexedDB === "undefined") return null;
  const database = await openDatabase();
  try {
    return await new Promise<T | null>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, mode);
      const pending = operation(transaction.objectStore(STORE_NAME));
      pending.onsuccess = () => resolve(pending.result ?? null);
      pending.onerror = () => reject(pending.error);
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    database.close();
  }
}

export function peekJournalCache(scope: string) {
  return memoryCache.get(normalizedScope(scope)) || null;
}

export async function loadJournalCache(scope: string, api: AetherApi) {
  const key = normalizedScope(scope);
  if (!key) return null;
  const memory = memoryCache.get(key);
  if (memory) return hydrateSnapshot(memory, api);
  try {
    const cached = await databaseRequest<CachedJournals>(
      "readonly",
      (store) => store.get(key)
    );
    if (!cached) return null;
    memoryCache.set(key, cached);
    return hydrateSnapshot(cached, api);
  } catch {
    return null;
  }
}

export async function saveJournalCache(scope: string, journals: Journal[]) {
  const key = normalizedScope(scope);
  if (!key) return;
  const cached: CachedJournals = {
    scope: key,
    journals: cloneForStorage(journals),
    savedAt: Date.now()
  };
  memoryCache.set(key, cached);
  await databaseRequest("readwrite", (store) => store.put(cached));
}

export async function clearJournalCache(scope: string) {
  const key = normalizedScope(scope);
  if (!key) return;
  memoryCache.delete(key);
  try {
    await databaseRequest("readwrite", (store) => store.delete(key));
  } catch {
    // Cache cleanup is best effort and must not block logout or archive restore.
  }
}

function hydrateSnapshot(cached: CachedJournals, api: AetherApi) {
  const clone = cloneForStorage(cached);
  return hydrateMediaSources(clone, api.serverUrl, api.accessToken) as CachedJournals;
}
