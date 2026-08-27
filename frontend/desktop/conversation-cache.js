(function exposeConversationCache(global) {
  const DATABASE_NAME = "aetherx-client-cache";
  const STORE_NAME = "conversation-snapshots";
  const PROFILE_STORE_NAME = "profile-snapshots";
  const VERSION = 2;

  function key(scope, conversationId) {
    return `${String(scope || "").toLowerCase()}\u0000${conversationId}`;
  }

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains(STORE_NAME)) {
          const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
          store.createIndex("scope", "scope", { unique: false });
        }
        if (!database.objectStoreNames.contains(PROFILE_STORE_NAME)) {
          database.createObjectStore(PROFILE_STORE_NAME, { keyPath: "scope" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transact(mode, callback) {
    if (typeof indexedDB === "undefined") return null;
    const database = await openDatabase();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = callback(transaction.objectStore(STORE_NAME));
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  async function load(scope, conversationId) {
    try {
      return await transact("readonly", (store) => store.get(key(scope, conversationId)));
    } catch {
      return null;
    }
  }

  async function save(scope, conversationId, messages) {
    const normalizedScope = String(scope || "").toLowerCase();
    if (!normalizedScope || !conversationId) return;
    const record = {
      key: key(normalizedScope, conversationId),
      scope: normalizedScope,
      conversationId,
      messages: JSON.parse(JSON.stringify(Array.isArray(messages) ? messages : [])),
      savedAt: Date.now()
    };
    await transact("readwrite", (store) => store.put(record));
  }

  async function clearScope(scope) {
    const normalizedScope = String(scope || "").toLowerCase();
    if (!normalizedScope || typeof indexedDB === "undefined") return;
    const database = await openDatabase();
    try {
      await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, "readwrite");
        const cursorRequest = transaction.objectStore(STORE_NAME)
          .index("scope").openKeyCursor(IDBKeyRange.only(normalizedScope));
        cursorRequest.onsuccess = () => {
          const cursor = cursorRequest.result;
          if (!cursor) return;
          transaction.objectStore(STORE_NAME).delete(cursor.primaryKey);
          cursor.continue();
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }

  global.AetherConversationCache = { load, save, clearScope };
})(window);
