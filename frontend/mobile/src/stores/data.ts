import { computed, readonly, ref } from "vue";
import type { AetherApi, Conversation, ConversationPage, GalleryImage, Journal, Memory, SyncChange, Todo } from "../lib/api";
import {
  clearMobileDataCache,
  createMobileDataSnapshot,
  loadMobileDataCache,
  saveMobileDataCache,
  warmGalleryPreviews
} from "../lib/mobile-cache";
import { MobileHealthReporter } from "../lib/device-health";
import { SyncCoordinator } from "../lib/sync";
import { useLocalHub, type LocalHubStatus } from "../lib/local-hub";
import { loadInstallationId, saveSyncCursor } from "../lib/storage";
import { useSessionStore } from "./session";
import { useModuleStore } from "./modules";

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
let controlSync: SyncCoordinator | null = null;
let controlHealthReporter: MobileHealthReporter | null = null;
let syncCursor = 0;
let sseConnected = false;
let controlSyncCursor = 0;
let controlSseConnected = false;
let controlSyncRetrying = false;
let restorePromise: Promise<boolean> | null = null;
let galleryPromise: Promise<void> | null = null;
let conversationPagePromise: Promise<ConversationPage> | null = null;
let activeCacheScope = "";
let archiveResetPromise: Promise<void> | null = null;
let lastArchiveResetCursor = 0;
let localHubSyncError = "";
let localHubOperation = {
  stage: "idle",
  progress: 0,
  message: "",
  updatedAt: 0
};
const CONVERSATION_PAGE_SIZE = 12;

function currentCacheScope() {
  const session = useSessionStore();
  const userName = session.user.value?.username;
  if (!userName) return "";
  return `${session.spaceId.value || session.requireApi().serverUrl}|${userName}`;
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
    const moduleStore = useModuleStore();
    if (!moduleStore.isEnabled("todo")) todos.value = [];
    if (!moduleStore.isEnabled("memory")) memories.value = [];
    if (!moduleStore.isEnabled("autonomous-journal")) journals.value = [];
    lastUpdatedAt.value = cached.savedAt;
    conversationRevision.value += 1;
    if (galleryAlbumImages.value.length) void warmGalleryPreviews(galleryAlbumImages.value);
    return true;
  })().finally(() => { restorePromise = null; });
  return restorePromise;
}

async function refreshAll() {
  const api = useSessionStore().requireApi();
  const moduleStore = useModuleStore();
  await moduleStore.hydrate().catch(() => undefined);
  loading.value = true;
  syncState.value = "syncing";
  try {
    const [todoResult, memoryResult, conversationResult, profileResult, assistantResult, galleryResult, journalResult] = await Promise.all([
      moduleStore.isEnabled("todo") ? api.listTodos() : Promise.resolve([]),
      moduleStore.isEnabled("memory") ? api.listMemories() : Promise.resolve([]),
      api.conversationPage(0, CONVERSATION_PAGE_SIZE),
      api.profile(),
      api.assistantProfile(),
      api.gallerySummary(3).catch(() => ({ total: 0, items: [] })),
      moduleStore.isEnabled("autonomous-journal")
        ? api.listJournals(50).catch(() => [])
        : Promise.resolve([])
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
  const moduleStore = useModuleStore();
  const jobs: Promise<void>[] = [];
  if (groups.has("todos") && moduleStore.isEnabled("todo")) jobs.push(api.listTodos().then((value) => { todos.value = value; }));
  if (groups.has("memories") && moduleStore.isEnabled("memory")) jobs.push(api.listMemories().then((value) => { memories.value = value; }));
  if (groups.has("conversations")) jobs.push(
    api.conversationPage(0, CONVERSATION_PAGE_SIZE).then(mergeConversationHead)
  );
  if (groups.has("profile")) jobs.push(api.profile().then((value) => { profile.value = value; }));
  if (groups.has("assistant")) jobs.push(api.assistantProfile().then((value) => { assistant.value = value; }));
  if (groups.has("gallery")) jobs.push(api.gallerySummary(3).then((value) => {
    galleryImages.value = value.items;
    galleryTotal.value = value.total;
  }));
  if (groups.has("journals") && moduleStore.isEnabled("autonomous-journal")) jobs.push(api.listJournals(50).then((value) => {
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
  const session = useSessionStore();
  const api = session.requireApi();
  const userId = session.user.value?.id;
  if (!userId) throw new Error("登录状态已经失效，请重新登录。");
  if ((api as AetherApi & { isLocalHub?: boolean }).isLocalHub) {
    syncState.value = "online";
    sseConnected = false;
    await startControlSync(session, userId);
    return;
  }
  if (sync) return;
  stopControlSyncTransport();
  const installationId = await loadInstallationId();
  sync = new SyncCoordinator(api, async (changes) => {
    const archiveReset = changes.find((change) => change.entityType === "archive_restore" && change.operation === "reset");
    if (archiveReset) {
      await resetAfterArchiveRestore(archiveReset.seq);
      return;
    }
    if (changes.some((change) => change.entityType === "module_settings")) {
      await useModuleStore().hydrate(true);
      await refreshAll();
      return;
    }
    const groups = changeGroups(changes);
    if (groups.size) await refreshGroups(groups);
  }, `${session.spaceId.value || api.serverUrl}|${session.user.value?.username || userId}`, (status) => {
    syncCursor = status.cursor;
    sseConnected = status.connected;
    if (status.state === "online") syncState.value = "online";
    void reportMobileHealth();
  }, installationId, (command) => handleHubCommand(command));
  try {
    await sync.start();
    healthReporter = new MobileHealthReporter(api, () => ({
      syncStatus: syncState.value,
      syncCursor,
      sseConnected,
      lastError: localHubSyncError || (syncState.value === "error" ? "实时同步通道正在重连" : ""),
      ...localHubHeartbeat()
    }));
    healthReporter.start();
  } catch {
    syncState.value = "error";
  }
}

async function startControlSync(
  session: ReturnType<typeof useSessionStore>,
  userId: string
) {
  if (controlSync) return;
  const connection = await session.createDesktopControlConnection();
  if (!connection) {
    throw new Error("手机 Hub 已启用，但找不到电脑 Hub 的控制连接，请重新配对。");
  }
  const installationId = await loadInstallationId();
  controlSync = new SyncCoordinator(
    connection.api,
    () => undefined,
    `${session.spaceId.value || connection.api.serverUrl}|control|${connection.nodeId}|${session.user.value?.username || userId}`,
    (status) => {
      controlSyncCursor = status.cursor;
      controlSseConnected = status.connected;
      controlSyncRetrying = status.state === "retrying";
      void controlHealthReporter?.report().catch(() => undefined);
    },
    installationId,
    (command) => handleHubCommand(command),
    { controlOnly: true }
  );
  await controlSync.start();
  controlHealthReporter = new MobileHealthReporter(connection.api, () => ({
    syncStatus: syncState.value,
    syncCursor: controlSyncCursor,
    sseConnected: controlSseConnected,
    lastError: localHubSyncError || (controlSyncRetrying ? "电脑 Hub 控制通道正在重连" : ""),
    ...localHubHeartbeat()
  }));
  controlHealthReporter.start();
}

async function handleHubCommand(command: Record<string, unknown>) {
  if (!["synchronize-local-hub", "switch-local-hub", "switch-desktop-hub", "resolve-hub-divergence"].includes(String(command.type || ""))) return;
  const session = useSessionStore();
  const localHub = useLocalHub();
  const localStatus = localHub.status.value || await localHub.refresh();
  if (!localStatus?.configured || localStatus.localNodeId !== String(command.nodeId || "")) return;
  if (Array.isArray(command.endpoints) && command.endpoints.length) {
    await localHub.updatePeerEndpoints({
      endpoints: command.endpoints as Array<Record<string, unknown>>
    });
  }
  if (command.type === "resolve-hub-divergence") {
    await handleDivergenceRecovery(session, localHub, command);
    return;
  }
  if (command.type === "switch-local-hub" || command.type === "switch-desktop-hub") {
    await handleRemoteHubSwitch(session, localHub, String(command.type));
    return;
  }
  const syncingToDesktop = localStatus.role === "active";
  const wasBootstrapIncomplete = localStatus.bootstrap?.status !== "completed" || localStatus.pendingMediaCount > 0;
  localHubOperation = {
    stage: "starting",
    progress: 5,
    message: syncingToDesktop ? "已收到同步到电脑 Hub 的指令" : "已收到同步到手机 Hub 的指令",
    updatedAt: Date.now()
  };
  void reportMobileHealth();
  const progressTimer = window.setInterval(() => {
    void refreshLocalHubOperation(localHub).catch(() => undefined);
  }, 1_000);
  try {
    await localHub.resume();
    await localHub.refresh();
    localHubOperation = {
      stage: "completed",
      progress: 100,
      message: syncingToDesktop
        ? "电脑 Hub 已追平手机端最新变更"
        : "手机 Hub 已追平电脑端最新变更",
      updatedAt: Date.now()
    };
    localHubSyncError = "";
  } catch (cause) {
    const recovered = await localHub.refresh().catch(() => null);
    if (wasBootstrapIncomplete && recovered?.bootstrap?.status === "completed" && recovered.pendingMediaCount === 0) {
      localHubSyncError = "";
      localHubOperation = deriveLocalHubProgress(recovered, false);
    } else {
      const error = cause as (Error & { code?: string }) | null;
      localHubSyncError = error instanceof Error
        ? error.code && !error.message.includes(error.code)
          ? `${error.message}（${error.code}）`
          : error.message
        : "手机 Hub 手动同步失败";
      localHubOperation = {
        ...localHubOperation,
        stage: "error",
        message: localHubSyncError,
        updatedAt: Date.now()
      };
    }
  } finally {
    window.clearInterval(progressTimer);
  }
  void reportMobileHealth();
}

async function handleDivergenceRecovery(
  session: ReturnType<typeof useSessionStore>,
  localHub: ReturnType<typeof useLocalHub>,
  command: Record<string, unknown>
) {
  const recoveryId = String(command.recoveryId || "");
  const authorityNodeId = String(command.authorityNodeId || "");
  if (!recoveryId || !authorityNodeId) return;
  localHubSyncError = "";
  localHubOperation = {
    stage: "divergence_recovery",
    progress: 8,
    message: "正在冻结双 Hub 写入并校验权威分支",
    updatedAt: Date.now()
  };
  await reportMobileHealth();
  try {
    const localNodeId = localHub.status.value?.localNodeId || "";
    localHubOperation = {
      stage: "divergence_snapshot",
      progress: 28,
      message: authorityNodeId === localNodeId
        ? "正在加密并上传手机 Hub 完整快照"
        : "正在下载并验证电脑 Hub 完整快照",
      updatedAt: Date.now()
    };
    await reportMobileHealth();
    await localHub.recoverDivergence({ recoveryId, authorityNodeId });
    localHubOperation = {
      stage: "divergence_recovered",
      progress: 100,
      message: "双 Hub 分歧已经闭环，正在恢复统一路由",
      updatedAt: Date.now()
    };
    if (authorityNodeId === localNodeId) await session.activateLocalHub();
    else await session.activateDesktopHub();
  } catch (cause) {
    const error = cause as Error | null;
    localHubSyncError = error instanceof Error ? error.message : "双 Hub 分歧恢复失败";
    localHubOperation = {
      stage: "divergence_recovery_error",
      progress: 0,
      message: localHubSyncError,
      updatedAt: Date.now()
    };
  }
  await reportMobileHealth();
}

async function handleRemoteHubSwitch(
  session: ReturnType<typeof useSessionStore>,
  localHub: ReturnType<typeof useLocalHub>,
  commandType: string
) {
  const toLocal = commandType === "switch-local-hub";
  localHubSyncError = "";
  localHubOperation = {
    stage: toLocal ? "switch_syncing" : "switch_returning",
    progress: toLocal ? 18 : 24,
    message: toLocal ? "正在追平最新变更并准备完整性校验" : "正在把活动节点安全交还给电脑 Hub",
    updatedAt: Date.now()
  };
  await reportMobileHealth();
  try {
    let current = localHub.status.value || await localHub.refresh();
    localHubOperation = {
      stage: "switch_syncing",
      progress: 32,
      message: toLocal ? "正在把手机副本追平到电脑 Hub" : "正在把手机端最新变更同步回电脑 Hub",
      updatedAt: Date.now()
    };
    await reportMobileHealth();
    await localHub.resume();
    current = await localHub.refresh();
    if (toLocal) {
      if (current?.role === "active" && current.state === "stable") return;
      localHubOperation = {
        stage: "switch_verifying",
        progress: 46,
        message: "正在核对操作链、记录根与原图根",
        updatedAt: Date.now()
      };
      await reportMobileHealth();
      await session.activateLocalHub();
    } else {
      if (current?.role === "standby" && current.state === "stable") return;
      await session.activateDesktopHub();
    }
    localHubSyncError = "";
    localHubOperation = {
      stage: "switch_completed",
      progress: 100,
      message: toLocal ? "手机 Hub 已成为当前 Hub" : "电脑 Hub 已重新成为当前 Hub",
      updatedAt: Date.now()
    };
    await reportMobileHealth();
  } catch (cause) {
    const error = cause as (Error & { code?: string }) | null;
    localHubSyncError = error instanceof Error
      ? error.code && !error.message.includes(error.code)
        ? `${error.message}（${error.code}）`
        : error.message
      : "Hub 切换失败";
    localHubOperation = {
      stage: "switch_error",
      progress: 0,
      message: localHubSyncError,
      updatedAt: Date.now()
    };
    await reportMobileHealth();
  }
}

async function refreshLocalHubOperation(localHub: ReturnType<typeof useLocalHub>) {
  const current = await localHub.refresh();
  if (!current) return;
  const progress = deriveLocalHubProgress(current, true);
  if (progress.stage === "completed") localHubSyncError = "";
  if (progress.stage === "completed" || localHubOperation.stage !== "error") {
    localHubOperation = progress;
  }
  await reportMobileHealth();
}

async function reportMobileHealth() {
  await Promise.all([
    healthReporter?.report(),
    controlHealthReporter?.report()
  ]);
}

function localHubHeartbeat() {
  const current = useLocalHub().status.value;
  if (!current?.configured) return {};
  const currentProgress = deriveLocalHubProgress(current, false);
  const switchProgressFresh = localHubOperation.stage.startsWith("switch_") &&
    Date.now() - localHubOperation.updatedAt < 12_000;
  const operation = switchProgressFresh
    ? localHubOperation
    : currentProgress.stage === "completed"
      ? currentProgress
    : localHubOperation.updatedAt
      ? localHubOperation
      : currentProgress;
  return {
    localHubNodeId: current.localNodeId,
    localHubStage: operation.stage,
    localHubProgress: operation.progress,
    localHubStatus: current.bootstrap?.status || current.role,
    localHubDocuments: current.documentCount,
    localHubMediaBytes: current.mediaBytes,
    localHubMediaTotalBytes: current.mediaTotalBytes,
    localHubPendingMedia: current.pendingMediaCount,
    localHubUpdatedAt: operation.updatedAt || Date.now(),
    localHubEndpoints: current.networkEndpoints || []
  };
}

function deriveLocalHubProgress(current: LocalHubStatus, operationActive: boolean) {
  const updatedAt = Date.now();
  const bootstrap = current.bootstrap;
  if (!bootstrap) {
    return operationActive
      ? { stage: "syncing_structure", progress: 15, message: "正在重新拉取完整结构化数据", updatedAt }
      : { stage: "ready_to_resume", progress: 15, message: "结构化数据尚未迁入，可继续恢复", updatedAt };
  }
  if (bootstrap.status === "waiting_blobs") {
    const total = Math.max(0, Number(current.mediaTotalBytes || 0));
    const received = Math.max(0, Math.min(total, Number(current.mediaBytes || 0)));
    const ratio = total > 0 ? received / total : current.pendingMediaCount ? 0 : 1;
    return {
      stage: operationActive ? "syncing_media" : "paused_media",
      progress: Math.round(35 + ratio * 50),
      message: current.pendingMediaCount
        ? `${operationActive ? "正在迁入" : "待继续迁入"}原图 · 剩余 ${current.pendingMediaCount} 项`
        : operationActive ? "正在核对原图" : "原图待继续核对",
      updatedAt
    };
  }
  if (bootstrap.status === "restored") {
    return operationActive
      ? { stage: "verifying", progress: 92, message: "正在进行完整性校验", updatedAt }
      : { stage: "ready_to_verify", progress: 92, message: "原图已迁入，等待最终校验", updatedAt };
  }
  if (operationActive) {
    return { stage: "syncing_changes", progress: 96, message: "正在追平最新变更", updatedAt };
  }
  return { stage: "completed", progress: 100, message: "手机 Hub 副本完整", updatedAt };
}

async function resetAfterArchiveRestore(resetCursor: number) {
  if (resetCursor <= lastArchiveResetCursor && !archiveResetPromise) return;
  if (archiveResetPromise) return archiveResetPromise;
  lastArchiveResetCursor = resetCursor;
  archiveResetPromise = (async () => {
    const scope = activeCacheScope || currentCacheScope();
    stopSyncTransport();
    resetData(false);
    if (scope) {
      await Promise.all([
        clearMobileDataCache(scope),
        saveSyncCursor(scope, resetCursor)
      ]);
    }
    activeCacheScope = scope;
    await useSessionStore().refreshCurrentUser();
    await useModuleStore().hydrate(true);
    await refreshAll();
    void preloadGallery().catch(() => undefined);
    await startSync();
  })().finally(() => { archiveResetPromise = null; });
  return archiveResetPromise;
}

function stopSync() {
  stopSyncTransport();
  resetData(true);
}

function stopSyncTransport() {
  stopDataSyncTransport();
  stopControlSyncTransport();
}

function stopDataSyncTransport() {
  sync?.stop();
  sync = null;
  healthReporter?.stop();
  healthReporter = null;
  syncCursor = 0;
  sseConnected = false;
}

function stopControlSyncTransport() {
  controlSync?.stop();
  controlSync = null;
  controlHealthReporter?.stop();
  controlHealthReporter = null;
  controlSyncCursor = 0;
  controlSseConnected = false;
  controlSyncRetrying = false;
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

async function reconnectHub(preserveControlTransport = false) {
  if (!preserveControlTransport) stopSyncTransport();
  resetData(false);
  await useModuleStore().hydrate(true).catch(() => undefined);
  const restored = await restoreCache();
  void refreshAll().catch(() => {
    if (!restored) syncState.value = "error";
  });
  void preloadGallery().catch(() => undefined);
  if (preserveControlTransport) {
    stopDataSyncTransport();
    await startSync();
  } else {
    void startSync().catch(() => { syncState.value = "error"; });
  }
}

window.addEventListener("aetherx:session-invalidated", stopSync);
window.addEventListener("aetherx:hub-routed", (event) => {
  const preserveControlTransport = (event as CustomEvent<{ local?: boolean }>).detail?.local === true;
  void reconnectHub(preserveControlTransport).catch(() => { syncState.value = "error"; });
});
window.addEventListener("aetherx:local-data-changed", (event) => {
  const detail = (event as CustomEvent<{ groups?: string[] }>).detail;
  const groups = new Set(detail?.groups || []);
  if (groups.size) void refreshGroups(groups).catch(() => undefined);
  void refreshConversationPage(true).catch(() => undefined);
});

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
    resetAfterArchiveRestore,
    toggleTodo,
    addTodo,
    removeTodo,
    confirmMemory,
    removeMemory,
    updateProfile,
    updateAssistantProfile
  };
}
