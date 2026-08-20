import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";
import { readonly, ref } from "vue";

export interface LocalHubStatus {
  running: boolean;
  configured: boolean;
  port: number;
  serverUrl: string;
  networkPort: number;
  networkEndpoints: ReadonlyArray<{
    transport: "lan" | "tailscale";
    address: string;
    priority: number;
  }>;
  peerEndpoints: ReadonlyArray<{
    nodeId: string;
    transport: "lan" | "anywhere" | "development";
    address: string;
    priority: number;
    certificateFingerprint: string;
  }>;
  allowInsecureLan: boolean;
  batteryOptimizationExempt: boolean;
  nodeId: string;
  localNodeId: string;
  activeNodeId: string;
  spaceId: string;
  epoch: number;
  state: string;
  role: "active" | "standby" | "unpaired";
  transitionId: string;
  transitionTargetNodeId: string;
  transitionStartedAt: number | null;
  protocolVersion: number;
  schemaVersion: number;
  documentCount: number;
  operationCount: number;
  mediaCount: number;
  pendingMediaCount: number;
  mediaBytes: number;
  mediaTotalBytes: number;
  bootstrap: null | {
    snapshotId: string;
    status: "waiting_blobs" | "restored" | "completed";
    recordsRoot: string;
    blobsRoot: string;
  };
  integrity: null | {
    snapshotId: string;
    recordsRoot: string;
    recordCount: number;
    verifiedAt: number;
  };
  forcedTakeover: null | {
    id: string;
    previousActiveNodeId: string;
    activeNodeId: string;
    previousEpoch: number;
    epoch: number;
    status: "pending_reconciliation" | "reconciled";
    createdAt: number;
    reconciledAt: number | null;
  };
  synchronization: {
    state: "idle" | "syncing" | "synced" | "error";
    stage: string;
    progress: number;
    direction: "" | "push" | "pull";
    message: string;
    applied: number;
    pushed: number;
    startedAt: number | null;
    updatedAt: number | null;
    completedAt: number | null;
  };
}

interface LocalHubPlugin {
  addListener(
    eventName: "networkRequest",
    listener: (request: LocalHubNetworkRequest) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: "peerEndpointDiscovered",
    listener: (endpoint: { nodeId: string; address: string; transport: "lan" }) => void
  ): Promise<PluginListenerHandle>;
  start(): Promise<LocalHubStatus>;
  stop(): Promise<LocalHubStatus>;
  status(): Promise<LocalHubStatus>;
  openBatteryOptimizationSettings(): Promise<{ opened: boolean }>;
  configure(input: Record<string, unknown>): Promise<LocalHubStatus>;
  updatePeerEndpoints(input: { endpoints: Array<Record<string, unknown>> }): Promise<LocalHubStatus>;
  importSnapshot(input: {
    snapshotId: string;
    spaceId: string;
    tables: Record<string, unknown[]>;
    account: Record<string, unknown>;
    credentials: Record<string, unknown>;
    media: Array<Record<string, unknown>>;
    manifest: Record<string, unknown>;
    replication: Record<string, unknown>;
  }): Promise<{ imported: boolean; snapshotId: string; spaceId: string; recordCount: number; recordsRoot: string }>;
  applyOperations(input: { operations: Record<string, unknown>[] }): Promise<{ applied: number; received: number }>;
  mutateDocument(input: {
    requestId: string;
    entityType: string;
    entityId: string;
    operation?: "upsert" | "delete";
    payload?: Record<string, unknown>;
    documentPayload?: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
  mutateDocuments(input: {
    requestId: string;
    mutations: Array<{
      entityType: string;
      entityId: string;
      operation?: "upsert" | "delete";
      payload?: Record<string, unknown>;
      documentPayload?: Record<string, unknown>;
    }>;
  }): Promise<{ operations: Array<Record<string, unknown>> }>;
  listDocuments(input: {
    entityType: string;
    includeDeleted?: boolean;
    payloadField?: string;
    payloadValue?: string;
  }): Promise<{ documents: Array<Record<string, unknown>> }>;
  localChanges(input: { after?: number; limit?: number }): Promise<{
    changes: Array<{
      seq: number;
      entityType: string;
      entityId: string;
      operation: "upsert" | "delete" | "reset";
      createdAt: number;
    }>;
    nextCursor: number;
    hasMore: boolean;
  }>;
  respondNetworkRequest(input: LocalHubNetworkResponse): Promise<{ accepted: boolean }>;
  verifyIntegrity(): Promise<{ recordsRoot: string; recordCount: number; verifiedAt: number }>;
  synchronize(): Promise<{
    synchronized: boolean;
    direction?: "push" | "pull";
    peerNodeId: string;
    applied?: number;
    pushed?: number;
    after: number;
    headSequence?: number;
    completedAt: number;
  }>;
  authorizeDesktopLogin(input: {
    challengeId: string;
    secret: string;
    expiresAt: number;
    endpoints: string[];
  }): Promise<{
    authorized: boolean;
    challengeId: string;
    computerNodeId: string;
    activeNodeId: string;
    desktopEndpoint: string;
    authorizedAt: number;
  }>;
  resume(): Promise<Record<string, unknown>>;
  bootstrapBlobs(): Promise<{ completed: boolean; downloadedBytes: number; blobCount: number; completedAt: number }>;
  finalizeBootstrap(): Promise<{ completed: boolean; receipt: Record<string, unknown>; completedAt: number }>;
  switchToLocal(): Promise<{ completed: boolean; transitionId?: string; activeNodeId: string; epoch: number; state?: string }>;
  switchToPeer(): Promise<{ completed: boolean; activeNodeId: string; epoch: number; state?: string }>;
  forceTakeover(): Promise<{ completed: boolean; takeoverId: string; activeNodeId: string; epoch: number; state: "forced_active" }>;
  recoverDivergence(input: {
    recoveryId: string;
    authorityNodeId: string;
  }): Promise<{
    completed: boolean;
    recovery: Record<string, unknown>;
    acknowledgement: Record<string, unknown>;
    completedAt: number;
  }>;
  media(input: { mediaId: string }): Promise<{ mediaId: string; mimeType: string; path: string; uri: string }>;
  providerCredentials(): Promise<{ baseUrl: string; model: string; apiKey: string }>;
  imageProviderCredentials(): Promise<{ baseUrl: string; model: string; apiKey: string }>;
  storeMedia(input: { dataUrl: string; mediaId?: string }): Promise<{
    mediaId: string; mimeType: string; fileName: string; byteSize: number; contentHash: string; localPath: string;
  }>;
}

const LocalHub = registerPlugin<LocalHubPlugin>("LocalHub");

interface LocalHubNetworkRequest {
  requestId: string;
  method: string;
  path: string;
  body: Record<string, unknown>;
}

interface LocalHubNetworkResponse {
  requestId: string;
  status: number;
  data?: unknown;
  error?: { code: string; message: string };
}
const status = ref<LocalHubStatus | null>(null);
const error = ref("");
const loading = ref(false);
const ACTIVE_REPLICATION_DEBOUNCE_MS = 180;
const ACTIVE_REPLICATION_RETRY_MS = 3_000;
let activeReplicationTimer: ReturnType<typeof setTimeout> | null = null;
let activeReplicationInFlight: Promise<void> | null = null;
let activeReplicationRequested = false;
let networkListener: Promise<PluginListenerHandle> | null = null;
let discoveryListener: Promise<PluginListenerHandle> | null = null;

function registerNetworkBridge() {
  if (Capacitor.getPlatform() !== "android") return;
  if (!networkListener) networkListener = LocalHub.addListener("networkRequest", (request) => {
    void import("./local-hub-network-api")
      .then(({ dispatchLocalHubNetworkRequest }) => dispatchLocalHubNetworkRequest(request))
      .then((data) => LocalHub.respondNetworkRequest({
        requestId: request.requestId,
        status: 200,
        data
      }))
      .catch((cause: unknown) => {
        const error = cause as { status?: number; code?: string; message?: string };
        return LocalHub.respondNetworkRequest({
          requestId: request.requestId,
          status: Number(error?.status) || 500,
          error: {
            code: String(error?.code || "LOCAL_HUB_REQUEST_FAILED"),
            message: String(error?.message || "手机 Hub 无法处理这个请求。")
          }
        });
      });
  });
  if (!discoveryListener) discoveryListener = LocalHub.addListener(
    "peerEndpointDiscovered",
    (endpoint) => {
      void refreshLocalHub().catch(() => undefined);
      window.dispatchEvent(new CustomEvent("aetherx:peer-endpoint-discovered", {
        detail: endpoint
      }));
    }
  );
}

function scheduleActiveReplication(delay = ACTIVE_REPLICATION_DEBOUNCE_MS) {
  if (Capacitor.getPlatform() !== "android") return;
  activeReplicationRequested = true;
  if (activeReplicationTimer) clearTimeout(activeReplicationTimer);
  activeReplicationTimer = setTimeout(() => {
    activeReplicationTimer = null;
    void flushActiveReplication();
  }, delay);
}

async function flushActiveReplication() {
  if (activeReplicationInFlight) return activeReplicationInFlight;
  activeReplicationRequested = false;
  activeReplicationInFlight = (async () => {
    const current = status.value || await refreshLocalHub();
    if (
      !current?.configured ||
      current.role !== "active" ||
      !["stable", "forced_active"].includes(current.state) ||
      current.bootstrap?.status !== "completed"
    ) return;
    try {
      await LocalHub.synchronize();
      await refreshLocalHub();
    } catch {
      // 网络暂时不可用时保留本地 Operation，稍后继续推送，不阻塞当前交互。
      scheduleActiveReplication(ACTIVE_REPLICATION_RETRY_MS);
    }
  })().finally(() => {
    activeReplicationInFlight = null;
    if (activeReplicationRequested && !activeReplicationTimer) {
      scheduleActiveReplication();
    }
  });
  return activeReplicationInFlight;
}

export async function initializeLocalHub() {
  if (Capacitor.getPlatform() !== "android") return null;
  registerNetworkBridge();
  loading.value = true;
  error.value = "";
  try {
    status.value = await LocalHub.start();
    if (status.value.role === "active") scheduleActiveReplication(0);
    return status.value;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Android Local Hub 启动失败。";
    return null;
  } finally {
    loading.value = false;
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && status.value?.role === "active") {
      scheduleActiveReplication(0);
    }
  });
}

export async function refreshLocalHub() {
  if (Capacitor.getPlatform() !== "android") return null;
  status.value = await LocalHub.status();
  return status.value;
}

export function useLocalHub() {
  return {
    status: readonly(status),
    error: readonly(error),
    loading: readonly(loading),
    available: Capacitor.getPlatform() === "android",
    refresh: refreshLocalHub,
    openBatteryOptimizationSettings: LocalHub.openBatteryOptimizationSettings,
    configure: async (input: Record<string, unknown>) => {
      status.value = await LocalHub.configure(input);
      return status.value;
    },
    updatePeerEndpoints: async (input: { endpoints: Array<Record<string, unknown>> }) => {
      status.value = await LocalHub.updatePeerEndpoints(input);
      return status.value;
    },
    importSnapshot: LocalHub.importSnapshot,
    applyOperations: LocalHub.applyOperations,
    mutateDocument: async (input: Parameters<LocalHubPlugin["mutateDocument"]>[0]) => {
      const result = await LocalHub.mutateDocument(input);
      scheduleActiveReplication();
      return result;
    },
    mutateDocuments: async (input: Parameters<LocalHubPlugin["mutateDocuments"]>[0]) => {
      const result = await LocalHub.mutateDocuments(input);
      scheduleActiveReplication();
      return result;
    },
    listDocuments: LocalHub.listDocuments,
    localChanges: LocalHub.localChanges,
    verifyIntegrity: async () => {
      const result = await LocalHub.verifyIntegrity();
      await refreshLocalHub();
      return result;
    },
    synchronize: async () => {
      const result = await LocalHub.synchronize();
      await refreshLocalHub();
      return result;
    },
    authorizeDesktopLogin: LocalHub.authorizeDesktopLogin,
    flushReplication: flushActiveReplication,
    resume: async () => {
      const result = await LocalHub.resume();
      await refreshLocalHub();
      return result;
    },
    bootstrapBlobs: async () => {
      const result = await LocalHub.bootstrapBlobs();
      await refreshLocalHub();
      return result;
    },
    finalizeBootstrap: async () => {
      const result = await LocalHub.finalizeBootstrap();
      await refreshLocalHub();
      return result;
    },
    switchToLocal: async () => {
      const result = await LocalHub.switchToLocal();
      await refreshLocalHub();
      return result;
    },
    switchToPeer: async () => {
      const result = await LocalHub.switchToPeer();
      await refreshLocalHub();
      return result;
    },
    forceTakeover: async () => {
      const result = await LocalHub.forceTakeover();
      await refreshLocalHub();
      scheduleActiveReplication(0);
      return result;
    },
    recoverDivergence: async (input: { recoveryId: string; authorityNodeId: string }) => {
      const result = await LocalHub.recoverDivergence(input);
      await refreshLocalHub();
      return result;
    },
    media: LocalHub.media,
    providerCredentials: LocalHub.providerCredentials,
    imageProviderCredentials: LocalHub.imageProviderCredentials,
    storeMedia: LocalHub.storeMedia
  };
}
