export interface AuthUser {
  id: string;
  username?: string;
  email?: string;
  emailVerified?: boolean;
  displayName: string;
}

export interface AuthConfig {
  registrationAvailable: boolean;
  firstUser: boolean;
  registrationMode: "open" | "invite" | "closed";
  requiresRegistrationSecret: boolean;
  loginIdentifier: "username" | "email";
  emailVerification: boolean;
  passwordReset: boolean;
  refreshSession: boolean;
}

export interface ClusterStatus {
  spaceId: string;
  localNodeId: string;
  activeNodeId: string;
  epoch: number;
  state: string;
  localRole: "active" | "standby";
  transitionId: string;
  transitionTargetNodeId: string;
  nodes: Array<{
    id: string;
    name: string;
    platform: string;
    status: string;
    role: "active" | "standby";
    lastSeenAt: number;
  }>;
}

export interface HubConnectionChange {
  baseUrl: string;
  token: string;
  user: AuthUser;
  spaceId: string;
  nodeId: string;
  activeNodeId: string;
  epoch: number;
}

export interface Todo {
  id: string;
  text: string;
  startAt: number;
  endAt: number;
  completed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Memory {
  id: string;
  domain: string;
  type: string;
  content: string;
  sourceExcerpt: string;
  source: "explicit" | "inferred" | "imported";
  confidence: number;
  importance: number;
  status: "candidate" | "active" | "archived";
  updatedAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationPage {
  items: Conversation[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface GalleryImage {
  id: string;
  source: string;
  originalSource?: string;
  mediaId?: string;
  description: string;
  origin: "chat" | "journal";
  refId: string;
  refTitle?: string;
  refType?: string;
  selfie?: boolean;
  createdAt: number;
}

export interface Journal {
  id: string;
  type: "daily" | "weekly";
  periodKey: string;
  title: string;
  content: string;
  mood: string;
  sourceFrom: number;
  sourceTo: number;
  sourceMessageCount: number;
  createdAt: number;
  updatedAt: number;
}

export type JournalSummary = Omit<Journal, "content"> & { content?: string };

export interface ModuleState {
  id: string;
  name: string;
  description: string;
  core: boolean;
  installed: boolean;
  requestedEnabled: boolean;
  enabled: boolean;
  dependencies: string[];
  blockedBy: string[];
  updatedAt: number | null;
}

export interface DeviceHeartbeatInput {
  installationId: string;
  name: string;
  platform: string;
  model: string;
  osVersion: string;
  appVersion: string;
  protocolVersion: number;
  syncStatus: "idle" | "syncing" | "online" | "error";
  syncCursor: number;
  sseConnected: boolean;
  foreground: boolean;
  currentModule?: string;
  lastInteractionAt?: number;
  latencyMs: number | null;
  lastError?: string;
  localHubNodeId?: string;
  localHubStage?: string;
  localHubProgress?: number;
  localHubStatus?: string;
  localHubDocuments?: number;
  localHubMediaBytes?: number;
  localHubMediaTotalBytes?: number;
  localHubPendingMedia?: number;
  localHubUpdatedAt?: number;
  localHubEndpoints?: ReadonlyArray<{
    transport: "lan" | "tailscale";
    address: string;
    priority: number;
  }>;
}

export interface ChatToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatActivityItem {
  id?: string;
  content?: string;
  title?: string;
  reason?: string;
  [key: string]: unknown;
}

export interface ChatMessage {
  id?: string;
  position?: number;
  role: "system" | "user" | "assistant" | "tool" | "memory";
  content: string | null;
  createdAt?: number;
  title?: string;
  detail?: string;
  risk?: "read" | "write" | "destructive";
  status?: "queued" | "running" | "waiting" | "success" | "error" | "denied" | "skipped";
  statusText?: string;
  expanded?: boolean;
  kind?: string;
  items?: ChatActivityItem[];
  journal?: {
    action?: string;
    items?: Array<{ title?: string; periodKey?: string; type?: string; mood?: string }>;
  };
  image?: {
    source?: string;
    originalSource?: string;
    mediaId?: string;
    mimeType?: string;
    description?: string;
    selfie?: boolean;
  };
  tool_calls?: ChatToolCall[];
  tool_call_id?: string;
  name?: string;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 0,
    readonly code = "API_ERROR",
    readonly requestId = "",
    readonly details: Record<string, unknown> | null = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type UnauthorizedHandler = () => void;
type ConnectionChangedHandler = (connection: HubConnectionChange) => void | Promise<void>;
type SessionChangedHandler = (session: AuthSessionResult) => void | Promise<void>;

export interface AuthSessionResult {
  token: string;
  refreshToken?: string;
  refreshExpiresAt?: number;
  sessionId?: string;
  user: AuthUser;
  expiresAt: number;
}

export interface AiConfig {
  providerId: string;
  providerName: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  verificationStatus?: "verified" | "failed" | "untested";
  verifiedAt?: number | null;
  verificationMessage?: string;
  updatedAt?: number | null;
}

export interface AiProviderProfile extends AiConfig {
  id: string;
  active: boolean;
  updatedAt: number;
}

export interface AiConfigInput {
  providerId: string;
  providerName: string;
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export type AiModelKind = "text" | "multimodal" | "image" | "video" | "embedding" | "rerank" | "audio" | "unknown";

export interface AiModelOption {
  id: string;
  name: string;
  ownedBy: string;
  created: number;
  contextLength: number;
  kind: AiModelKind;
  capabilities: string[];
  supportedProtocols: string[];
  inputModalities: string[];
  outputModalities: string[];
  selectableForChat: boolean;
}

export interface AiModelsResult {
  items: AiModelOption[];
  fetchedAt: number;
}

export interface BillingModuleDescriptor {
  id: string;
  providerId: string;
  name: string;
  capabilities: { balance: boolean; paymentSessions: boolean };
  limits: { minimumAmount: number; maximumAmount: number; integerOnly: boolean };
}

export interface BillingBalance {
  moduleId: string;
  currency: "CNY";
  unit: "micro-yuan";
  creditsMicros: number;
  usedMicros: number;
  balanceMicros: number;
}

export interface BillingPaymentSession {
  id: string;
  moduleId: string;
  amount: number;
  status: "pending" | "paid" | "failed" | "closed" | "refunded";
  paymentUrl?: string;
  expiresAt: number;
  createdAt: number;
  updatedAt?: number;
  paidAt?: number | null;
}

export class AetherApi {
  private baseUrl = "";
  private token = "";
  private refreshToken = "";
  private onUnauthorized?: UnauthorizedHandler;
  private onSessionChanged?: SessionChangedHandler;
  private onConnectionChanged?: ConnectionChangedHandler;
  private routePromise: Promise<boolean> | null = null;
  private refreshPromise: Promise<boolean> | null = null;

  constructor(options: {
    baseUrl: string;
    token?: string;
    refreshToken?: string;
    onUnauthorized?: UnauthorizedHandler;
    onSessionChanged?: SessionChangedHandler;
    onConnectionChanged?: ConnectionChangedHandler;
  }) {
    this.setConnection(options.baseUrl, options.token || "");
    this.refreshToken = options.refreshToken || "";
    this.onUnauthorized = options.onUnauthorized;
    this.onSessionChanged = options.onSessionChanged;
    this.onConnectionChanged = options.onConnectionChanged;
  }

  setConnection(baseUrl: string, token = this.token) {
    const normalized = normalizeServerUrl(baseUrl);
    if (!normalized) throw new ApiError("服务器地址需要以 http:// 或 https:// 开头。", 400, "INVALID_SERVER_URL");
    this.baseUrl = normalized;
    this.token = token;
  }

  get serverUrl() {
    return this.baseUrl;
  }

  get accessToken() {
    return this.token;
  }

  get sessionRefreshToken() {
    return this.refreshToken;
  }

  async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const ownController = signal ? null : new AbortController();
    const activeSignal = signal || ownController?.signal;
    const timeoutMs = path.includes("/ai/image-generations") || path.includes("/agent/")
      ? 300_000
      : 65_000;
    const timeout = ownController ? window.setTimeout(() => ownController.abort(), timeoutMs) : 0;
    const requestId = isWriteMethod(method) ? crypto.randomUUID() : "";
    try {
      return await this.performRequest<T>(
        method,
        path,
        body,
        activeSignal,
        requestId,
        true
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if ((error as Error).name === "AbortError") {
        throw new ApiError("连接超时，请检查电脑端是否在线。", 504, "BACKEND_TIMEOUT");
      }
      throw new ApiError(`连接不到 AetherX：${(error as Error).message}`, 0, "BACKEND_UNAVAILABLE");
    } finally {
      if (timeout) window.clearTimeout(timeout);
    }
  }

  private async performRequest<T>(
    method: string,
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    requestId: string,
    allowRoute: boolean,
    allowRefresh = true
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        ...(requestId ? { "X-Request-Id": requestId } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal
    });
    const payload = response.status === 204 ? { data: null } : await response.json();
    if (!response.ok) {
      const error = new ApiError(
        payload?.error?.message || `请求失败（HTTP ${response.status}）`,
        response.status,
        payload?.error?.code || "API_ERROR",
        payload?.requestId || "",
        payload?.error?.details || null
      );
      if (
        allowRoute &&
        response.status === 409 &&
        error.code === "HUB_NOT_ACTIVE" &&
        path !== "/api/v1/cluster/session-handoff" &&
        await this.routeToActiveHub(signal)
      ) {
        return this.performRequest<T>(method, path, body, signal, requestId, false, allowRefresh);
      }
      if (
        allowRefresh &&
        response.status === 401 &&
        path !== "/api/v1/auth/refresh" &&
        await this.refreshAccessSession(signal)
      ) {
        return this.performRequest<T>(method, path, body, signal, requestId, allowRoute, false);
      }
      if (response.status === 401) this.onUnauthorized?.();
      throw error;
    }
    return hydrateMediaSources(payload.data, this.baseUrl, this.token) as T;
  }

  private async refreshAccessSession(signal?: AbortSignal) {
    if (!this.refreshToken) return false;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = (async () => {
      const response = await fetch(`${this.baseUrl}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refreshToken: this.refreshToken }),
        signal
      });
      const payload = await response.json().catch(() => ({}));
      const session = payload?.data as AuthSessionResult | undefined;
      if (!response.ok || !session?.token || !session.refreshToken) return false;
      this.token = session.token;
      this.refreshToken = session.refreshToken;
      await this.onSessionChanged?.(session);
      return true;
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async routeToActiveHub(signal?: AbortSignal) {
    if (!this.token) return false;
    if (this.routePromise) return this.routePromise;
    this.routePromise = (async () => {
      const response = await fetch(`${this.baseUrl}/api/v1/cluster/session-handoff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          "X-Request-Id": crypto.randomUUID()
        },
        body: "{}",
        signal
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new ApiError(
          payload?.error?.message || "无法切换到当前活动 Hub。",
          response.status,
          payload?.error?.code || "HUB_HANDOFF_FAILED",
          payload?.requestId || ""
        );
      }
      const handoff = payload.data;
      if (!handoff?.handedOff) return false;
      const baseUrl = normalizeServerUrl(handoff.serverUrl);
      if (!baseUrl || !handoff.token || !handoff.user || !handoff.spaceId) {
        throw new ApiError("活动 Hub 返回了无效的会话交接结果。", 502, "HUB_HANDOFF_INVALID");
      }
      this.setConnection(baseUrl, handoff.token);
      await this.onConnectionChanged?.({
        baseUrl,
        token: handoff.token,
        user: handoff.user,
        spaceId: handoff.spaceId,
        nodeId: handoff.nodeId,
        activeNodeId: handoff.activeNodeId,
        epoch: Number(handoff.epoch)
      });
      return true;
    })().finally(() => { this.routePromise = null; });
    return this.routePromise;
  }

  async ensureActiveHub(signal?: AbortSignal) {
    const status = await this.clusterStatus(signal);
    if (status.localNodeId !== status.activeNodeId) {
      await this.routeToActiveHub(signal);
      return this.clusterStatus(signal);
    }
    return status;
  }

  health(signal?: AbortSignal) { return this.request<{ status: string; service: string }>("GET", "/health", undefined, signal); }
  authConfig() { return this.request<AuthConfig>("GET", "/api/v1/auth/config"); }
  register(input: { username?: string; email?: string; displayName?: string; password: string; registrationSecret?: string }) {
    return this.request<{
      token?: string;
      user?: AuthUser;
      expiresAt?: number;
      migratedExistingData?: boolean;
      accepted?: boolean;
      verificationRequired?: boolean;
      email?: string;
    }>("POST", "/api/v1/auth/register", input);
  }
  login(input: { username?: string; email?: string; password: string }) {
    return this.request<AuthSessionResult>("POST", "/api/v1/auth/login", input);
  }
  verifyEmail(token: string) {
    return this.request<AuthSessionResult>("POST", "/api/v1/auth/email/verify", { token });
  }
  resendEmailVerification(input: { email: string; password: string }) {
    return this.request<{ accepted: boolean }>("POST", "/api/v1/auth/email/resend", input);
  }
  requestPasswordReset(email: string) {
    return this.request<{ accepted: boolean }>("POST", "/api/v1/auth/password/forgot", { email });
  }
  resetPassword(input: { token: string; password: string }) {
    return this.request<{ reset: boolean }>("POST", "/api/v1/auth/password/reset", input);
  }
  session(signal?: AbortSignal) { return this.request<{ user: AuthUser }>("GET", "/api/v1/auth/session", undefined, signal); }
  clusterStatus(signal?: AbortSignal) { return this.request<ClusterStatus>("GET", "/api/v1/cluster/status", undefined, signal); }
  logout() { return this.request<null>("POST", "/api/v1/auth/logout"); }
  analyticsPresence(input: DeviceHeartbeatInput) {
    return this.request<{ accepted: boolean; serverTime: number }>("POST", "/api/v1/analytics/presence", input);
  }
  analyticsEvents(events: Array<Record<string, unknown>>) {
    return this.request<{ accepted: number; serverTime: number }>("POST", "/api/v1/analytics/events", { events });
  }
  claimPairingSession(id: string, input: { secret: string; deviceName: string; publicKey?: string }) {
    return this.request<{ status: "pending" }>("POST", `/api/v1/pairing/sessions/${encodeURIComponent(id)}/claim`, input);
  }
  redeemPairingSession(id: string, secret: string) {
    return this.request<{ token: string; device: { id: string; name: string } }>("POST", `/api/v1/pairing/sessions/${encodeURIComponent(id)}/redeem`, { secret });
  }
  claimHubPairingSession(id: string, input: Record<string, unknown>, signal?: AbortSignal) {
    return this.request<{ status: "pending" }>("POST", `/api/v1/hub-pairing/sessions/${encodeURIComponent(id)}/claim`, input, signal);
  }
  reuseHubPairingSession(id: string, input: {
    secret: string;
    nodeId: string;
    clientEphemeralPublicKey: string;
  }, signal?: AbortSignal) {
    return this.request<{
      status: "redeemed";
      reused: true;
      nodeId: string;
      sourceNodeId: string;
      envelope: Record<string, unknown>;
    }>(
      "POST",
      `/api/v1/hub-pairing/sessions/${encodeURIComponent(id)}/reuse`,
      input,
      signal
    );
  }
  resolveHubPairingSession(id: string, secret: string, signal?: AbortSignal) {
    return this.request<Record<string, unknown>>(
      "POST",
      `/api/v1/hub-pairing/sessions/${encodeURIComponent(id)}/resolve`,
      { secret },
      signal
    );
  }
  redeemHubPairingSession(id: string, secret: string) {
    return this.request<{
      status: "redeemed";
      spaceId: string;
      nodeId: string;
      sourceNodeId: string;
      envelope: Record<string, unknown>;
    }>("POST", `/api/v1/hub-pairing/sessions/${encodeURIComponent(id)}/redeem`, { secret });
  }
  deviceHeartbeat(input: DeviceHeartbeatInput) {
    return this.request<{ serverTime: number }>("POST", "/api/v1/devices/heartbeat", input);
  }
  profile() { return this.request<Record<string, unknown>>("GET", "/api/v1/profile"); }
  updateProfile(input: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("PATCH", "/api/v1/profile", input);
  }
  assistantProfile() { return this.request<Record<string, unknown>>("GET", "/api/v1/assistant/profile"); }
  updateAssistantProfile(input: Record<string, unknown>) {
    return this.request<Record<string, unknown>>("PATCH", "/api/v1/assistant/profile", input);
  }
  gallerySummary(limit = 3) {
    return this.request<{ total: number; items: GalleryImage[] }>(
      "GET",
      `/api/v1/assistant/gallery/summary?limit=${encodeURIComponent(limit)}`
    );
  }
  galleryPage(offset = 0, limit = 24) {
    return this.request<{ items: GalleryImage[]; total: number; offset: number; limit: number; hasMore: boolean }>(
      "GET",
      `/api/v1/assistant/gallery/page?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`
    );
  }
  listJournals(limit = 1) {
    return this.request<Journal[]>(
      "GET",
      `/api/v1/assistant/journals?limit=${encodeURIComponent(limit)}`
    );
  }
  listJournalSummaries(limit = 100) {
    return this.request<JournalSummary[]>(
      "GET",
      `/api/v1/assistant/journals?limit=${encodeURIComponent(limit)}&includeContent=false`
    );
  }
  journalById(id: string) {
    return this.request<Journal>(
      "GET",
      `/api/v1/assistant/journals/by-id/${encodeURIComponent(id)}`
    );
  }
  aiConfig() { return this.request<AiConfig>("GET", "/api/v1/ai/config"); }
  updateAiConfig(input: AiConfigInput) {
    return this.request<AiConfig>("PUT", "/api/v1/ai/config", input);
  }
  aiProviderProfiles() {
    return this.request<{ activeProviderId: string; items: AiProviderProfile[]; integrations?: Array<{ id: string }> }>("GET", "/api/v1/ai/providers");
  }
  listProviderIntegrations() {
    return this.request<{ items: Array<Record<string, unknown>> }>("GET", "/api/v1/ai/provider-integrations");
  }
  startProviderOAuth(integrationId: string) {
    return this.request<{ flowId: string; authorizationUrl: string }>("POST", `/api/v1/ai/provider-integrations/${encodeURIComponent(integrationId)}/oauth/start`, {});
  }
  providerOAuthStatus(integrationId: string, flowId: string) {
    return this.request<{ status: string; errorMessage?: string }>("GET", `/api/v1/ai/provider-integrations/${encodeURIComponent(integrationId)}/oauth/status/${encodeURIComponent(flowId)}`);
  }
  listBillingModules() {
    return this.request<{ items: BillingModuleDescriptor[] }>("GET", "/api/v1/billing/modules");
  }
  billingBalance(moduleId: string) {
    return this.request<BillingBalance>("GET", `/api/v1/billing/modules/${encodeURIComponent(moduleId)}/balance`);
  }
  createBillingPaymentSession(moduleId: string, amount: number) {
    return this.request<BillingPaymentSession>("POST", `/api/v1/billing/modules/${encodeURIComponent(moduleId)}/payment-sessions`, { amount });
  }
  billingPaymentStatus(moduleId: string, sessionId: string) {
    return this.request<BillingPaymentSession>("GET", `/api/v1/billing/modules/${encodeURIComponent(moduleId)}/payment-sessions/${encodeURIComponent(sessionId)}`);
  }
  saveAiProviderProfile(input: AiConfigInput) {
    return this.request<AiProviderProfile>(
      "PUT",
      `/api/v1/ai/providers/${encodeURIComponent(input.providerId)}`,
      input
    );
  }
  testAiProviderProfile(input: AiConfigInput) {
    return this.request<AiProviderProfile>(
      "POST",
      `/api/v1/ai/providers/${encodeURIComponent(input.providerId)}/test`,
      input
    );
  }
  listAiProviderModels(input: AiConfigInput) {
    return this.request<AiModelsResult>(
      "POST",
      `/api/v1/ai/providers/${encodeURIComponent(input.providerId)}/models`,
      input
    );
  }
  activateAiProvider(providerId: string) {
    return this.request<AiConfig>(
      "POST",
      `/api/v1/ai/providers/${encodeURIComponent(providerId)}/activate`,
      {}
    );
  }
  agentChat(input: { conversationId?: string; content: string; responseMode?: "full" | "delta"; runtime?: Record<string, unknown> }) {
    return this.request<AgentChatResult>("POST", "/api/v1/agent/chat", input);
  }
  approveAgentRun(id: string, approved: boolean) {
    return this.request<AgentChatResult>("POST", `/api/v1/agent/runs/${encodeURIComponent(id)}/approve`, { approved });
  }
  listModules() { return this.request<ModuleState[]>("GET", "/api/v1/modules"); }
  updateModule(id: string, enabled: boolean) {
    return this.request<ModuleState[]>("PATCH", `/api/v1/modules/${encodeURIComponent(id)}`, { enabled });
  }
  listTodos(status = "all") { return this.request<Todo[]>("GET", `/api/v1/todos?status=${encodeURIComponent(status)}`); }
  createTodo(input: { text: string; startAt: number; endAt: number }) { return this.request<Todo>("POST", "/api/v1/todos", input); }
  updateTodo(id: string, input: Partial<Todo>) { return this.request<Todo>("PATCH", `/api/v1/todos/${encodeURIComponent(id)}`, input); }
  deleteTodo(id: string) { return this.request<null>("DELETE", `/api/v1/todos/${encodeURIComponent(id)}`); }
  listMemories(status = "") { return this.request<Memory[]>("GET", `/api/v1/memories${status ? `?status=${encodeURIComponent(status)}` : ""}`); }
  confirmMemory(id: string) { return this.request<Memory>("POST", `/api/v1/memories/${encodeURIComponent(id)}/confirm`, {}); }
  deleteMemory(id: string) { return this.request<null>("DELETE", `/api/v1/memories/${encodeURIComponent(id)}`); }
  listConversations() { return this.request<Conversation[]>("GET", "/api/v1/conversations"); }
  conversationPage(offset = 0, limit = 12) {
    return this.request<ConversationPage>(
      "GET",
      `/api/v1/conversations/page?offset=${encodeURIComponent(offset)}&limit=${encodeURIComponent(limit)}`
    );
  }
  conversation(id: string) {
    return this.request<{ conversation: Conversation; displayMessages: ChatMessage[]; modelMessages: ChatMessage[] }>("GET", `/api/v1/conversations/${encodeURIComponent(id)}`);
  }
  conversationMessagePage(id: string, afterPosition = -1, limit = 500) {
    return this.request<{ items: ChatMessage[]; nextPosition: number; hasMore: boolean }>(
      "GET",
      `/api/v1/conversations/${encodeURIComponent(id)}/message-page?afterPosition=${encodeURIComponent(afterPosition)}&limit=${encodeURIComponent(limit)}`
    );
  }
  syncChanges(after: number, limit = 200) {
    return this.request<{ changes: SyncChange[]; nextCursor: number; hasMore: boolean }>("GET", `/api/v1/sync/changes?after=${after}&limit=${limit}`);
  }
  syncCommands(clientId: string) {
    return this.request<{ commands: Array<Record<string, unknown>> }>(
      "GET",
      `/api/v1/sync/commands?client_id=${encodeURIComponent(clientId)}`
    );
  }
  createArchiveExport(password: string, secretPolicy: "excluded" | "password_encrypted" = "excluded") {
    return this.request<{
      ticket: string;
      fileName: string;
      expiresAt: number;
      downloadPath: string;
      summary: {
        continuityDigest: string;
        totalMediaBytes: number;
        formatVersion: number;
        sourceEdition: "local" | "cloud";
        secretPolicy: "excluded" | "password_encrypted";
      };
    }>("POST", "/api/v1/archives/export", { password, secretPolicy });
  }
  archiveDownloadUrl(downloadPath: string) {
    const value = String(downloadPath || "");
    if (!value.startsWith("/api/v1/archives/download/")) {
      throw new ApiError("存档下载地址无效。", 400, "ARCHIVE_DOWNLOAD_INVALID");
    }
    return `${this.baseUrl}${value}`;
  }
  async restoreArchive(file: Blob, password: string) {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/archives/restore`, {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.aetherx.archive",
          "X-AetherX-Archive-Password": utf8Base64(password),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
        },
        body: file
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new ApiError(
          payload?.error?.message || `导入存档失败（HTTP ${response.status}）。`,
          response.status,
          payload?.error?.code || "ARCHIVE_RESTORE_FAILED",
          payload?.requestId || ""
        );
        if (response.status === 401) this.onUnauthorized?.();
        throw error;
      }
      return payload.data as {
        continuityDigest: string;
        resetRequired: boolean;
        resetCursor: number;
        backupFileName: string;
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(`导入存档时无法连接 Hub：${(error as Error).message}`, 0, "BACKEND_UNAVAILABLE");
    }
  }
}

export function hydrateMediaSources(value: unknown, baseUrl: string, token: string): unknown {
  if (Array.isArray(value)) {
    value.forEach((item) => hydrateMediaSources(item, baseUrl, token));
    return value;
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record.mediaId === "string" && record.mediaId) {
    const mediaUrl = `${baseUrl}/api/v1/media/${encodeURIComponent(record.mediaId)}`;
    const auth = token ? `&access_token=${encodeURIComponent(token)}` : "";
    record.source = `${mediaUrl}?variant=preview${auth}`;
    record.originalSource = `${mediaUrl}${token ? `?access_token=${encodeURIComponent(token)}` : ""}`;
  }
  Object.values(record).forEach((item) => hydrateMediaSources(item, baseUrl, token));
  return value;
}

export interface SyncChange {
  seq: number;
  entityType: string;
  entityId: string;
  operation: "upsert" | "delete" | "reset";
  createdAt: number;
}

export interface AgentChatResult {
  status: "completed" | "approval_required";
  runId: string | null;
  conversation: Conversation;
  displayMessages: ChatMessage[];
  toolMutated: boolean;
  pendingApproval: { activityId: string } | null;
}

export function normalizeServerUrl(value: string) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    return "";
  }
  if (url.protocol === "https:") return url.origin;
  if (url.protocol !== "http:" || !isPrivateHttpHost(url.hostname)) return "";
  return url.origin;
}

function isPrivateHttpHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1") return true;
  if (host.includes(":") && (host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80:"))) {
    return true;
  }
  const octets = host.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  return octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168) ||
    (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127);
}

function isWriteMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(String(method).toUpperCase());
}

function utf8Base64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}
