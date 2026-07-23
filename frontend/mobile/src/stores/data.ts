import { computed, readonly, ref } from "vue";
import type { Conversation, ConversationPage, GalleryImage, Journal, Memory, SyncChange, Todo } from "../lib/api";
import {
  clearMobileDataCache,
  createMobileDataSnapshot,
  loadMobileDataCache,
  saveMobileDataCache,
  warmGalleryPreviews
} from "../lib/mobile-cache";
import { MobileHealthReporter } from "../lib/device-health";
import { SyncCoordinator } from "../lib/sync";
import { loadInstallationId } from "../lib/storage";
import { useSessionStore } from "./session";

const todos = ref<Todo[]>([]);
const memories = ref<Memory[]>([]);
const conversations = ref<Conversation[]>([]);
const conversationTotal = ref(0);
const conversationHasMore = ref(false);
const conversationPageLoading = ref(false);
const profile = ref<Record<string, unknown>>({});
const assistant = ref<Record<string, unknown>>({});
const galleryImages = ref<GalleryImage[]>([]);
const galleryTotal = ref(0);
const galleryAlbumImages = ref<GalleryImage[]>([]);
const galleryAlbumTotal = ref(0);
const galleryAlbumLoading = ref(false);
const journals = ref<Journal[]>([]);
const loading = ref(false);
const lastUpdatedAt = ref<number | null>(null);
const conversationRevision = ref(0);
const syncState = ref<"idle" | "syncing" | "online" | "error">("idle");
let sync: SyncCoordinator | null = null;
let healthReporter: MobileHealthReporter | null = null;
let syncCursor = 0;
let sseConnected = false;
let restorePromise: Promise<boolean> | null = null;
let galleryPromise: Promise<void> | null = null;
let conversationPagePromise: Promise<ConversationPage> | null = null;
let activeCacheScope = "";
const CONVERSATION_PAGE_SIZE = 12;

function currentCacheScope() {
  const session = useSessionStore();
  const userId = session.user.value?.id;
  if (!userId) return "";
  return `${session.requireApi().serverUrl}|${userId}`;
}

function snapshot() {
  return createMobileDataSnapshot({
    todos: todos.value,
    memories: memories.value,
    conversations: conversations.value,
    profile: profile.value,
    assistant: assistant.value,
    galleryImages: galleryImages.value,
    galleryTotal: galleryTotal.value,
    galleryAlbumImages: galleryAlbumImages.value,
    galleryAlbumTotal: galleryAlbumTotal.value,
    journals: journals.value
  });
}

async function persistCache() {
  const scope = activeCacheScope || currentCacheScope();
  if (!scope) return;
  activeCacheScope = scope;
  await saveMobileDataCache(scope, snapshot());
}

async function restoreCache() {
  if (lastUpdatedAt.value) return true;
  if (restorePromise) return restorePromise;
  restorePromise = (async () => {
    const session = useSessionStore();
    const scope = currentCacheScope();
    if (!scope) return false;
    activeCacheScope = scope;
    const cached = await loadMobileDataCache(scope, session.requireApi());
    if (!cached) return false;
    todos.value = cached.todos || [];
    memories.value = cached.memories || [];
    conversations.value = cached.conversations || [];
    conversationTotal.value = conversations.value.length;
    conversationHasMore.value = conversations.value.length > 0;
    profile.value = cached.profile || {};
    assistant.value = cached.assistant || {};
    galleryImages.value = cached.galleryImages || [];
    galleryTotal.value = cached.galleryTotal || 0;
    galleryAlbumImages.value = cached.galleryAlbumImages || [];
    galleryAlbumTotal.value = cached.galleryAlbumTotal || galleryAlbumImages.value.length;
    journals.value = cached.journals || [];
    lastUpdatedAt.value = cached.savedAt;
    conversationRevision.value += 1;
    if (galleryAlbumImages.value.length) void warmGalleryPreviews(galleryAlbumImages.value);
    return true;
  })().finally(() => { restorePromise = null; });
  return restorePromise;
}

async function refreshAll() {
  const api = useSessionStore().requireApi();
  loading.value = true;
  syncState.value = "syncing";
  try {
    const [todoResult, memoryResult, conversationResult, profileResult, assistantResult, galleryResult, journalResult] = await Promise.all([
      api.listTodos(),
      api.listMemories(),
      api.conversationPage(0, CONVERSATION_PAGE_SIZE),
      api.profile(),
      api.assistantProfile(),
      api.gallerySummary(3).catch(() => ({ total: 0, items: [] })),
      api.listJournals(50).catch(() => [])
    ]);
    todos.value = todoResult;
    memories.value = memoryResult;
    mergeConversationHead(conversationResult);
    profile.value = profileResult;
    assistant.value = assistantResult;
    galleryImages.value = galleryResult.items;
    galleryTotal.value = galleryResult.total;
    journals.value = journalResult;
    lastUpdatedAt.value = Date.now();
    syncState.value = "online";
    await persistCache();
  } catch (error) {
    syncState.value = "error";
    throw error;
  } finally {
    loading.value = false;
  }
}

async function refreshGroups(groups: Set<string>) {
  const api = useSessionStore().requireApi();
  const jobs: Promise<void>[] = [];
  if (groups.has("todos")) jobs.push(api.listTodos().then((value) => { todos.value = value; }));
  if (groups.has("memories")) jobs.push(api.listMemories().then((value) => { memories.value = value; }));
  if (groups.has("conversations")) jobs.push(
    api.conversationPage(0, CONVERSATION_PAGE_SIZE).then(mergeConversationHead)
  );
  if (groups.has("profile")) jobs.push(api.profile().then((value) => { profile.value = value; }));
  if (groups.has("assistant")) jobs.push(api.assistantProfile().then((value) => { assistant.value = value; }));
  if (groups.has("gallery")) jobs.push(api.gallerySummary(3).then((value) => {
    galleryImages.value = value.items;
    galleryTotal.value = value.total;
  }));
  if (groups.has("journals")) jobs.push(api.listJournals(50).then((value) => {
    journals.value = value;
  }));
  await Promise.all(jobs);
  if (groups.has("gallery")) await preloadGallery().catch(() => undefined);
  lastUpdatedAt.value = Date.now();
  syncState.value = "online";
  await persistCache();
}

async function preloadGallery() {
  if (galleryPromise) return galleryPromise;
  galleryPromise = (async () => {
    const api = useSessionStore().requireApi();
    galleryAlbumLoading.value = true;
    try {
      const refreshed: GalleryImage[] = [];
      let total = 0;
      let hasMore = true;
      while (hasMore) {
        const page = await api.galleryPage(refreshed.length, 24);
        refreshed.push(...page.items);
        total = page.total;
        hasMore = page.hasMore && page.items.length > 0;
        if (refreshed.length === page.items.length) void warmGalleryPreviews(refreshed, 4);
      }
      galleryAlbumImages.value = refreshed;
      galleryAlbumTotal.value = Math.max(total, refreshed.length);
      galleryImages.value = refreshed.slice(0, 3);
      galleryTotal.value = galleryAlbumTotal.value;
      lastUpdatedAt.value = Date.now();
      await persistCache();
      void warmGalleryPreviews(refreshed);
    } finally {
      galleryAlbumLoading.value = false;
    }
  })().finally(() => { galleryPromise = null; });
  return galleryPromise;
}

function mergeConversationHead(page: ConversationPage) {
  const headIds = new Set(page.items.map((item) => item.id));
  conversations.value = [...page.items, ...conversations.value.filter((item) => !headIds.has(item.id))]
    .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
  conversationTotal.value = page.total;
  conversationHasMore.value = conversations.value.length < page.total;
  conversationRevision.value += 1;
}

async function refreshConversationPage(reset = false, limit = CONVERSATION_PAGE_SIZE) {
  if (conversationPagePromise) return conversationPagePromise;
  const offset = reset ? 0 : conversations.value.length;
  conversationPageLoading.value = true;
  const api = useSessionStore().requireApi();
  conversationPagePromise = api.conversationPage(offset, limit).then((page) => {
    if (reset) {
      conversations.value = page.items;
    } else {
      const known = new Set(conversations.value.map((item) => item.id));
      conversations.value = [...conversations.value, ...page.items.filter((item) => !known.has(item.id))]
        .sort((left, right) => (right.updatedAt || 0) - (left.updatedAt || 0));
    }
    conversationTotal.value = page.total;
    conversationHasMore.value = conversations.value.length < page.total && page.items.length > 0;
    conversationRevision.value += 1;
    lastUpdatedAt.value = Date.now();
    void persistCache().catch(() => undefined);
    return page;
  }).finally(() => {
    conversationPageLoading.value = false;
    conversationPagePromise = null;
  });
  return conversationPagePromise;
}

async function loadRemainingConversations() {
  while (conversationHasMore.value) {
    await waitForConversationIdle();
    const before = conversations.value.length;
    try {
      await refreshConversationPage(false);
    } catch {
      return;
    }
    if (conversations.value.length <= before) return;
  }
}

function waitForConversationIdle() {
  return new Promise<void>((resolve) => {
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") idle(() => resolve(), { timeout: 800 });
    else window.setTimeout(resolve, 180);
  });
}

function changeGroups(changes: SyncChange[]) {
  const groups = new Set<string>();
  for (const change of changes) {
    const type = change.entityType;
    if (type === "todos") groups.add("todos");
    else if (["memories", "memory_evidence"].includes(type)) groups.add("memories");
    else if (type === "conversations") groups.add("conversations");
    else if (type === "messages") {
      groups.add("conversations");
      groups.add("gallery");
    }
    else if (type === "user_profiles") groups.add("profile");
    else if (["assistant_profiles", "assistant_personality_events", "shared_memories"].includes(type)) groups.add("assistant");
    else if (["assistant_journals", "assistant_journals_v2"].includes(type)) {
      groups.add("gallery");
      groups.add("journals");
    }
  }
  return groups;
}

async function startSync() {
  if (sync) return;
  const session = useSessionStore();
  const api = session.requireApi();
  const userId = session.user.value?.id;
  if (!userId) throw new Error("登录状态已经失效，请重新登录。");
  const installationId = await loadInstallationId();
  sync = new SyncCoordinator(api, async (changes) => {
    const groups = changeGroups(changes);
    if (groups.size) await refreshGroups(groups);
  }, `${api.serverUrl}|${userId}`, (status) => {
    syncCursor = status.cursor;
    sseConnected = status.connected;
    if (status.state === "online") syncState.value = "online";
    else if (status.state === "retrying") syncState.value = "error";
    void healthReporter?.report().catch(() => undefined);
  }, installationId);
  try {
    await sync.start();
    healthReporter = new MobileHealthReporter(api, () => ({
      syncStatus: syncState.value,
      syncCursor,
      sseConnected,
      lastError: syncState.value === "error" ? "实时同步通道正在重连" : ""
    }));
    healthReporter.start();
  } catch {
    syncState.value = "error";
  }
}

function stopSync() {
  stopSyncTransport();
  resetData(true);
}

function stopSyncTransport() {
  sync?.stop();
  sync = null;
  healthReporter?.stop();
  healthReporter = null;
  syncCursor = 0;
  sseConnected = false;
}

function resetData(clearCache: boolean) {
  todos.value = [];
  memories.value = [];
  conversations.value = [];
  conversationTotal.value = 0;
  conversationHasMore.value = false;
  conversationPageLoading.value = false;
  profile.value = {};
  assistant.value = {};
  galleryImages.value = [];
  galleryTotal.value = 0;
  galleryAlbumImages.value = [];
  galleryAlbumTotal.value = 0;
  galleryAlbumLoading.value = false;
  journals.value = [];
  lastUpdatedAt.value = null;
  conversationRevision.value += 1;
  syncState.value = "idle";
  const scope = activeCacheScope;
  activeCacheScope = "";
  restorePromise = null;
  galleryPromise = null;
  conversationPagePromise = null;
  if (clearCache && scope) void clearMobileDataCache(scope);
}

async function reconnectHub() {
  stopSyncTransport();
  resetData(false);
  const restored = await restoreCache();
  void refreshAll().catch(() => {
    if (!restored) syncState.value = "error";
  });
  void preloadGallery().catch(() => undefined);
  void startSync().catch(() => { syncState.value = "error"; });
}

window.addEventListener("aetherx:session-invalidated", stopSync);

async function toggleTodo(todo: Todo) {
  const updated = await useSessionStore().requireApi().updateTodo(todo.id, { completed: !todo.completed });
  todos.value = todos.value.map((item) => item.id === updated.id ? updated : item);
  await persistCache();
}

async function addTodo(input: { text: string; startAt: number; endAt: number }) {
  const created = await useSessionStore().requireApi().createTodo(input);
  todos.value = [...todos.value, created].sort((a, b) => a.startAt - b.startAt);
  await persistCache();
}

async function removeTodo(id: string) {
  await useSessionStore().requireApi().deleteTodo(id);
  todos.value = todos.value.filter((item) => item.id !== id);
  await persistCache();
}

async function confirmMemory(id: string) {
  const updated = await useSessionStore().requireApi().confirmMemory(id);
  memories.value = memories.value.map((item) => item.id === id ? updated : item);
  await persistCache();
}

async function removeMemory(id: string) {
  await useSessionStore().requireApi().deleteMemory(id);
  memories.value = memories.value.filter((item) => item.id !== id);
  await persistCache();
}

async function updateProfile(input: Record<string, unknown>) {
  profile.value = await useSessionStore().requireApi().updateProfile(input);
  lastUpdatedAt.value = Date.now();
  await persistCache();
}

async function updateAssistantProfile(input: Record<string, unknown>) {
  assistant.value = await useSessionStore().requireApi().updateAssistantProfile(input);
  lastUpdatedAt.value = Date.now();
  await persistCache();
}

export function useDataStore() {
  return {
    todos: readonly(todos),
    memories: readonly(memories),
    conversations: readonly(conversations),
    conversationTotal: readonly(conversationTotal),
    conversationHasMore: readonly(conversationHasMore),
    conversationPageLoading: readonly(conversationPageLoading),
    profile: readonly(profile),
    assistant: readonly(assistant),
    galleryImages: readonly(galleryImages),
    galleryTotal: readonly(galleryTotal),
    galleryAlbumImages: readonly(galleryAlbumImages),
    galleryAlbumTotal: readonly(galleryAlbumTotal),
    galleryAlbumLoading: readonly(galleryAlbumLoading),
    journals: readonly(journals),
    loading: readonly(loading),
    lastUpdatedAt: readonly(lastUpdatedAt),
    conversationRevision: readonly(conversationRevision),
    syncState: readonly(syncState),
    activeTodos: computed(() => todos.value.filter((todo) => !todo.completed)),
    pendingMemories: computed(() => memories.value.filter((memory) => memory.status === "candidate")),
    refreshAll,
    refreshConversationPage,
    loadRemainingConversations,
    restoreCache,
    preloadGallery,
    startSync,
    stopSync,
    reconnectHub,
    toggleTodo,
    addTodo,
    removeTodo,
    confirmMemory,
    removeMemory,
    updateProfile,
    updateAssistantProfile
  };
}
