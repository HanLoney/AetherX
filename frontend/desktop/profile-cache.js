(function exposeProfileCache(global) {
  const DATABASE_NAME = "aetherx-client-cache";
  const CONVERSATION_STORE = "conversation-snapshots";
  const PROFILE_STORE = "profile-snapshots";
  const VERSION = 2;
  const memoryCache = new Map();
  const writeQueues = new Map();

  function normalizeScope(scope) {
    return String(scope || "").trim().toLowerCase();
  }

  function clone(value) {
    if (value === undefined) return undefined;
    if (typeof structuredClone === "function") return structuredClone(value);
    return JSON.parse(JSON.stringify(value));
  }

  function ensureStores(database) {
    if (!database.objectStoreNames.contains(CONVERSATION_STORE)) {
      const conversations = database.createObjectStore(CONVERSATION_STORE, { keyPath: "key" });
      conversations.createIndex("scope", "scope", { unique: false });
    }
    if (!database.objectStoreNames.contains(PROFILE_STORE)) {
      database.createObjectStore(PROFILE_STORE, { keyPath: "scope" });
    }
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, VERSION);
      request.onupgradeneeded = () => ensureStores(request.result);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transact(mode, callback) {
    if (typeof indexedDB === "undefined") return null;
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(PROFILE_STORE, mode);
        const request = callback(transaction.objectStore(PROFILE_STORE));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  async function load(scope) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope) return null;
    if (memoryCache.has(normalizedScope)) return clone(memoryCache.get(normalizedScope));
    try {
      const snapshot = await transact("readonly", (store) => store.get(normalizedScope));
      if (snapshot) memoryCache.set(normalizedScope, snapshot);
      return clone(snapshot);
    } catch {
      return null;
    }
  }

  async function save(scope, patch) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope || !patch || typeof patch !== "object") return null;
    const previous = writeQueues.get(normalizedScope) || Promise.resolve();
    const queued = previous.catch(() => undefined).then(async () => {
      const existing = memoryCache.get(normalizedScope) ||
        await transact("readonly", (store) => store.get(normalizedScope)) || {};
      const snapshot = {
        ...existing,
        ...clone(patch),
        scope: normalizedScope,
        savedAt: Date.now()
      };
      memoryCache.set(normalizedScope, snapshot);
      await transact("readwrite", (store) => store.put(snapshot));
      return clone(snapshot);
    });
    writeQueues.set(normalizedScope, queued);
    try {
      return await queued;
    } finally {
      if (writeQueues.get(normalizedScope) === queued) writeQueues.delete(normalizedScope);
    }
  }

  async function clear(scope) {
    const normalizedScope = normalizeScope(scope);
    if (!normalizedScope) return;
    memoryCache.delete(normalizedScope);
    try {
      await transact("readwrite", (store) => store.delete(normalizedScope));
    } catch {
      // Cache cleanup must never block logout or archive recovery.
    }
  }

  global.AetherProfileCache = { load, save, clear };
})(window);
