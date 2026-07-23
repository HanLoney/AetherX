export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
}

export interface AuthConfig {
  registrationAvailable: boolean;
  firstUser: boolean;
  registrationMode: "open" | "invite" | "closed";
  requiresRegistrationSecret: boolean;
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
  latencyMs: number | null;
  lastError?: string;
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
    readonly requestId = ""
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type UnauthorizedHandler = () => void;

export class AetherApi {
  private baseUrl = "";
  private token = "";
  private onUnauthorized?: UnauthorizedHandler;

  constructor(options: { baseUrl: string; token?: string; onUnauthorized?: UnauthorizedHandler }) {
    this.setConnection(options.baseUrl, options.token || "");
    this.onUnauthorized = options.onUnauthorized;
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

  async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    const ownController = signal ? null : new AbortController();
    const activeSignal = signal || ownController?.signal;
    const timeoutMs = path.includes("/ai/image-generations") || path.includes("/agent/")
      ? 300_000
      : 65_000;
    const timeout = ownController ? window.setTimeout(() => ownController.abort(), timeoutMs) : 0;
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: activeSignal
      });
      const payload = response.status === 204 ? { data: null } : await response.json();
      if (!response.ok) {
        const error = new ApiError(
          payload?.error?.message || `请求失败（HTTP ${response.status}）`,
          response.status,
          payload?.error?.code || "API_ERROR",
          payload?.requestId || ""
        );
        if (response.status === 401) this.onUnauthorized?.();
        throw error;
      }
      return hydrateMediaSources(payload.data, this.baseUrl, this.token) as T;
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

  health() { return this.request<{ status: string; service: string }>("GET", "/health"); }
  authConfig() { return this.request<AuthConfig>("GET", "/api/v1/auth/config"); }
  register(input: { username: string; displayName?: string; password: string; registrationSecret?: string }) {
    return this.request<{ token: string; user: AuthUser; expiresAt: number; migratedExistingData: boolean }>("POST", "/api/v1/auth/register", input);
  }
  login(input: { username: string; password: string }) {
    return this.request<{ token: string; user: AuthUser; expiresAt: number }>("POST", "/api/v1/auth/login", input);
  }
  session() { return this.request<{ user: AuthUser }>("GET", "/api/v1/auth/session"); }
  logout() { return this.request<null>("POST", "/api/v1/auth/logout"); }
  claimPairingSession(id: string, input: { secret: string; deviceName: string; publicKey?: string }) {
    return this.request<{ status: "pending" }>("POST", `/api/v1/pairing/sessions/${encodeURIComponent(id)}/claim`, input);
  }
  redeemPairingSession(id: string, secret: string) {
    return this.request<{ token: string; device: { id: string; name: string } }>("POST", `/api/v1/pairing/sessions/${encodeURIComponent(id)}/redeem`, { secret });
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
  aiConfig() { return this.request<{ hasApiKey: boolean; model?: string }>("GET", "/api/v1/ai/config"); }
  agentChat(input: { conversationId?: string; content: string; runtime?: Record<string, unknown> }) {
    return this.request<AgentChatResult>("POST", "/api/v1/agent/chat", input);
  }
  approveAgentRun(id: string, approved: boolean) {
    return this.request<AgentChatResult>("POST", `/api/v1/agent/runs/${encodeURIComponent(id)}/approve`, { approved });
  }
  listTodos(status = "all") { return this.request<Todo[]>("GET", `/api/v1/todos?status=${encodeURIComponent(status)}`); }
  createTodo(input: { text: string; startAt: number; endAt: number }) { return this.request<Todo>("POST", "/api/v1/todos", input); }
  updateTodo(id: string, input: Partial<Todo>) { return this.request<Todo>("PATCH", `/api/v1/todos/${encodeURIComponent(id)}`, input); }
  deleteTodo(id: string) { return this.request<null>("DELETE", `/api/v1/todos/${encodeURIComponent(id)}`); }
  listMemories(status = "") { return this.request<Memory[]>("GET", `/api/v1/memories${status ? `?status=${encodeURIComponent(status)}` : ""}`); }
  confirmMemory(id: string) { return this.request<Memory>("POST", `/api/v1/memories/${encodeURIComponent(id)}/confirm`, {}); }
  deleteMemory(id: string) { return this.request<null>("DELETE", `/api/v1/memories/${encodeURIComponent(id)}`); }
  listConversations() { return this.request<Conversation[]>("GET", "/api/v1/conversations"); }
  conversation(id: string) {
    return this.request<{ conversation: Conversation; displayMessages: ChatMessage[]; modelMessages: ChatMessage[] }>("GET", `/api/v1/conversations/${encodeURIComponent(id)}`);
  }
  syncChanges(after: number, limit = 200) {
    return this.request<{ changes: SyncChange[]; nextCursor: number; hasMore: boolean }>("GET", `/api/v1/sync/changes?after=${after}&limit=${limit}`);
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
  operation: "upsert" | "delete";
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
  return /^https?:\/\//i.test(normalized) ? normalized : "";
}
