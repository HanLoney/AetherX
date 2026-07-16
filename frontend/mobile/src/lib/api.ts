export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
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

export interface ChatMessage {
  id?: string;
  role: "system" | "user" | "assistant";
  content: string;
  createdAt?: number;
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
    const timeout = ownController ? window.setTimeout(() => ownController.abort(), 65_000) : 0;
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
      return payload.data as T;
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
  profile() { return this.request<Record<string, unknown>>("GET", "/api/v1/profile"); }
  assistantProfile() { return this.request<Record<string, unknown>>("GET", "/api/v1/assistant/profile"); }
  aiConfig() { return this.request<{ hasApiKey: boolean; model?: string }>("GET", "/api/v1/ai/config"); }
  promptSettings() { return this.request<{ compiledPrompt?: string }>("GET", "/api/v1/prompt-settings"); }
  recallMemories(query: string) { return this.request<{ context?: string }>("POST", "/api/v1/memories/recall", { query }); }
  extractMemories(input: Record<string, unknown>) { return this.request("POST", "/api/v1/memories/extract", input); }
  requestAi(input: Record<string, unknown>) { return this.request<Record<string, unknown>>("POST", "/api/v1/ai/chat", input); }
  listTodos(status = "all") { return this.request<Todo[]>("GET", `/api/v1/todos?status=${encodeURIComponent(status)}`); }
  createTodo(input: { text: string; startAt: number; endAt: number }) { return this.request<Todo>("POST", "/api/v1/todos", input); }
  updateTodo(id: string, input: Partial<Todo>) { return this.request<Todo>("PATCH", `/api/v1/todos/${encodeURIComponent(id)}`, input); }
  deleteTodo(id: string) { return this.request<null>("DELETE", `/api/v1/todos/${encodeURIComponent(id)}`); }
  listMemories(status = "") { return this.request<Memory[]>("GET", `/api/v1/memories${status ? `?status=${encodeURIComponent(status)}` : ""}`); }
  confirmMemory(id: string) { return this.request<Memory>("POST", `/api/v1/memories/${encodeURIComponent(id)}/confirm`, {}); }
  deleteMemory(id: string) { return this.request<null>("DELETE", `/api/v1/memories/${encodeURIComponent(id)}`); }
  listConversations() { return this.request<Conversation[]>("GET", "/api/v1/conversations"); }
  createConversation(title: string) { return this.request<Conversation>("POST", "/api/v1/conversations", { title }); }
  conversation(id: string) {
    return this.request<{ conversation: Conversation; displayMessages: ChatMessage[]; modelMessages: ChatMessage[] }>("GET", `/api/v1/conversations/${encodeURIComponent(id)}`);
  }
  saveMessages(id: string, messages: Array<Record<string, unknown>>) {
    return this.request<{ saved: number }>("PUT", `/api/v1/conversations/${encodeURIComponent(id)}/messages`, { messages });
  }
  syncChanges(after: number, limit = 200) {
    return this.request<{ changes: SyncChange[]; nextCursor: number; hasMore: boolean }>("GET", `/api/v1/sync/changes?after=${after}&limit=${limit}`);
  }
}

export interface SyncChange {
  seq: number;
  entityType: string;
  entityId: string;
  operation: "upsert" | "delete";
  createdAt: number;
}

export function normalizeServerUrl(value: string) {
  const normalized = String(value || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(normalized) ? normalized : "";
}
