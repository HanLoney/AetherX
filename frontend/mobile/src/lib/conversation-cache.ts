import type { ChatMessage, Conversation } from "./api";

const DATABASE_NAME = "aetherx-client-cache";
const STORE_NAME = "conversation-snapshots";
const VERSION = 1;
const memoryCache = new Map<string, CachedConversation>();
let lastSavedAt = 0;

export interface CachedConversation {
  key: string;
  scope: string;
  conversationId: string;
  conversation: Conversation;
  messages: ChatMessage[];
  savedAt: number;
}

function cacheKey(scope: string, conversationId: string) {
  return `${String(scope || "").toLocaleLowerCase()}\u0000${conversationId}`;
}

function normalizedScope(scope: string) {
  return String(scope || "").toLocaleLowerCase();
}

function newestConversation(cached: CachedConversation[]) {
  return cached.reduce<CachedConversation | null>((latest, item) => {
    if (!latest || Number(item.savedAt || 0) > Number(latest.savedAt || 0)) return item;
    return latest;
  }, null);
}

function rememberConversation(cached: CachedConversation) {
  memoryCache.set(cached.key, cached);
  lastSavedAt = Math.max(lastSavedAt, Number(cached.savedAt || 0));
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
        const store = database.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex("scope", "scope", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function request<T>(mode: IDBTransactionMode, operation: (store: IDBObjectStore) => IDBRequest<T>) {
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

export async function loadConversationCache(scope: string, conversationId: string) {
  const key = cacheKey(scope, conversationId);
  const memory = memoryCache.get(key);
  if (memory) return memory;
  try {
    const cached = await request<CachedConversation>(
      "readonly",
      (store) => store.get(key)
    );
    if (cached) rememberConversation(cached);
    return cached;
  } catch {
    return null;
  }
}

export function peekConversationCache(scope: string, conversationId: string) {
  return memoryCache.get(cacheKey(scope, conversationId)) || null;
}

export function peekLatestConversationCache(scope: string) {
  const targetScope = normalizedScope(scope);
  return newestConversation(
    [...memoryCache.values()].filter((cached) => cached.scope === targetScope)
  );
}

export async function loadLatestConversationCache(scope: string) {
  const targetScope = normalizedScope(scope);
  if (!targetScope) return null;
  const memory = peekLatestConversationCache(targetScope);
  try {
    const rows = await request<CachedConversation[]>(
      "readonly",
      (store) => store.index("scope").getAll(targetScope)
    );
    const persisted = newestConversation(rows || []);
    if (persisted) rememberConversation(persisted);
    if (!memory) return persisted;
    if (!persisted) return memory;
    return Number(persisted.savedAt || 0) > Number(memory.savedAt || 0) ? persisted : memory;
  } catch {
    return memory;
  }
}

export async function saveConversationCache(
  scope: string,
  conversation: Conversation,
  messages: ChatMessage[]
) {
  const targetScope = normalizedScope(scope);
  if (!targetScope || !conversation?.id) return;
  const cached = {
    key: cacheKey(targetScope, conversation.id),
    scope: targetScope,
    conversationId: conversation.id,
    // Vue refs expose nested values as Proxy objects. IndexedDB cannot
    // structured-clone those proxies, so persist an ordinary data snapshot.
    conversation: cloneForStorage(conversation),
    messages: cloneForStorage(messages),
    savedAt: Math.max(Date.now(), lastSavedAt + 1)
  } satisfies CachedConversation;
  rememberConversation(cached);
  await request("readwrite", (store) => store.put(cached));
}

export function normalizeMessagePositions(messages: ChatMessage[]) {
  return (Array.isArray(messages) ? messages : []).map((message, index) => ({
    ...message,
    position: Number.isSafeInteger(Number(message.position))
      ? Number(message.position)
      : index
  }));
}

export function dedupeConversationMessages(messages: ChatMessage[]) {
  const result: ChatMessage[] = [];
  const ids = new Set<string>();
  const positions = new Map<number, number>();
  const ordered = normalizeMessagePositions(messages).sort(compareConversationMessages);
  for (const message of ordered) {
    if (message.id && ids.has(message.id)) continue;
    const position = Number(message.position);
    if (Number.isSafeInteger(position) && positions.has(position)) {
      result[positions.get(position)!] = message;
      if (message.id) ids.add(message.id);
      continue;
    }
    const previous = result.at(-1);
    if (
      previous &&
      previous.role === message.role &&
      String(previous.content || "") === String(message.content || "") &&
      Math.abs(Number(previous.createdAt || 0) - Number(message.createdAt || 0)) <= 2_000
    ) {
      if (message.id) ids.add(message.id);
      continue;
    }
    if (message.id) ids.add(message.id);
    if (Number.isSafeInteger(position)) positions.set(position, result.length);
    result.push(message);
  }
  return result.sort(compareConversationMessages);
}

function compareConversationMessages(left: ChatMessage, right: ChatMessage) {
  const leftCreatedAt = Number(left.createdAt);
  const rightCreatedAt = Number(right.createdAt);
  if (
    Number.isFinite(leftCreatedAt) && leftCreatedAt > 0 &&
    Number.isFinite(rightCreatedAt) && rightCreatedAt > 0 &&
    leftCreatedAt !== rightCreatedAt
  ) {
    return leftCreatedAt - rightCreatedAt;
  }
  return Number(left.position) - Number(right.position);
}

export function mergeConversationTail(
  cachedMessages: ChatMessage[],
  receivedMessages: ChatMessage[],
  overlapStart: number
) {
  const retained = normalizeMessagePositions(cachedMessages).filter(
    (message) => Number(message.position) <= overlapStart
  );
  const byId = new Map<string, ChatMessage>();
  for (const [index, message] of [...retained, ...normalizeMessagePositions(receivedMessages)].entries()) {
    const key = message.id || `position:${Number(message.position)}:${index}`;
    byId.set(key, message);
  }
  return dedupeConversationMessages([...byId.values()].sort(
    (left, right) => Number(left.position) - Number(right.position)
  ));
}
