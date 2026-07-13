class ApiError extends Error {
  constructor(message, status = 0, code = "API_ERROR", requestId = "") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

class XuanApiClient {
  constructor(options = {}) {
    this.setBaseUrl(options.baseUrl || "http://127.0.0.1:4318");
    this.token = String(options.token || "");
    this.onUnauthorized = options.onUnauthorized;
  }

  setBaseUrl(baseUrl) {
    const value = String(baseUrl || "").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(value)) {
      throw new ApiError("服务器地址需要以 http:// 或 https:// 开头。", 400, "INVALID_SERVER_URL");
    }
    this.baseUrl = value;
  }

  setToken(token) {
    this.token = String(token || "");
  }

  async request(method, path, body) {
    const controller = new AbortController();
    const timeout = path.includes("/ai/image-generations") ? 245_000 : 65_000;
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal
      });
      const payload =
        response.status === 204 ? { data: null } : await response.json();
      if (!response.ok) {
        const error = new ApiError(
          payload?.error?.message || `后端请求失败（HTTP ${response.status}）`,
          response.status,
          payload?.error?.code,
          payload?.requestId
        );
        if (response.status === 401 && typeof this.onUnauthorized === "function") {
          this.onUnauthorized(error);
        }
        throw error;
      }
      return payload.data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (error.name === "AbortError") {
        throw new ApiError("后端请求超时。", 504, "BACKEND_TIMEOUT");
      }
      throw new ApiError(
        `无法连接 AetherX 后端：${error.message}`,
        0,
        "BACKEND_UNAVAILABLE"
      );
    } finally {
      clearTimeout(timer);
    }
  }

  getAuthConfig() {
    return this.request("GET", "/api/v1/auth/config");
  }

  register(input) {
    return this.request("POST", "/api/v1/auth/register", input);
  }

  login(input) {
    return this.request("POST", "/api/v1/auth/login", input);
  }

  getSession() {
    return this.request("GET", "/api/v1/auth/session");
  }

  logout() {
    return this.request("POST", "/api/v1/auth/logout");
  }

  getAiConfig() {
    return this.request("GET", "/api/v1/ai/config");
  }

  saveAiConfig(config) {
    return this.request("PUT", "/api/v1/ai/config", config);
  }

  requestAi(payload) {
    return this.request("POST", "/api/v1/ai/chat", payload);
  }

  getAiImageConfig() {
    return this.request("GET", "/api/v1/ai/image-config");
  }

  saveAiImageConfig(config) {
    return this.request("PUT", "/api/v1/ai/image-config", config);
  }

  generateImage(payload) {
    return this.request("POST", "/api/v1/ai/image-generations", payload);
  }

  listTodos(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/todos${query.size ? `?${query}` : ""}`
    );
  }

  getTodo(id) {
    return this.request("GET", `/api/v1/todos/${encodeURIComponent(id)}`);
  }

  createTodo(todo) {
    return this.request("POST", "/api/v1/todos", todo);
  }

  updateTodo(id, changes) {
    return this.request(
      "PATCH",
      `/api/v1/todos/${encodeURIComponent(id)}`,
      changes
    );
  }

  deleteTodo(id) {
    return this.request("DELETE", `/api/v1/todos/${encodeURIComponent(id)}`);
  }

  clearCompletedTodos() {
    return this.request("DELETE", "/api/v1/todos/completed");
  }

  getProfile() {
    return this.request("GET", "/api/v1/profile");
  }

  saveProfile(profile) {
    return this.request("PUT", "/api/v1/profile", profile);
  }

  updateProfile(changes) {
    return this.request("PATCH", "/api/v1/profile", changes);
  }

  getAssistantProfile() {
    return this.request("GET", "/api/v1/assistant/profile");
  }

  updateAssistantProfile(changes) {
    return this.request("PATCH", "/api/v1/assistant/profile", changes);
  }

  listJournals(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/assistant/journals${query.size ? `?${query}` : ""}`
    );
  }

  getJournal(type, periodKey) {
    return this.request(
      "GET",
      `/api/v1/assistant/journals/${encodeURIComponent(type)}/${encodeURIComponent(periodKey)}`
    );
  }

  getJournalMaterial(from, to) {
    const query = new URLSearchParams({ from: String(from), to: String(to) });
    return this.request("GET", `/api/v1/assistant/journals/material?${query}`);
  }

  saveJournal(journal) {
    return this.request("PUT", "/api/v1/assistant/journals", journal);
  }

  deleteJournal(id) {
    return this.request(
      "DELETE",
      `/api/v1/assistant/journals/${encodeURIComponent(id)}`
    );
  }

  listPersonalityEvents(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/assistant/personality-events${query.size ? `?${query}` : ""}`
    );
  }

  createPersonalityEvent(event) {
    return this.request(
      "POST",
      "/api/v1/assistant/personality-events",
      event
    );
  }

  deletePersonalityEvent(id) {
    return this.request(
      "DELETE",
      `/api/v1/assistant/personality-events/${encodeURIComponent(id)}`
    );
  }

  confirmPersonalityEvent(id) {
    return this.request(
      "POST",
      `/api/v1/assistant/personality-events/${encodeURIComponent(id)}/confirm`,
      {}
    );
  }

  listSharedMemories(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/shared-memories${query.size ? `?${query}` : ""}`
    );
  }

  createSharedMemory(memory) {
    return this.request("POST", "/api/v1/shared-memories", memory);
  }

  deleteSharedMemory(id) {
    return this.request(
      "DELETE",
      `/api/v1/shared-memories/${encodeURIComponent(id)}`
    );
  }

  confirmSharedMemory(id) {
    return this.request(
      "POST",
      `/api/v1/shared-memories/${encodeURIComponent(id)}/confirm`,
      {}
    );
  }

  listPreferences(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/preferences${query.size ? `?${query}` : ""}`
    );
  }

  savePreference(preference) {
    return this.request("PUT", "/api/v1/preferences", preference);
  }

  deletePreference(id) {
    return this.request(
      "DELETE",
      `/api/v1/preferences/${encodeURIComponent(id)}`
    );
  }

  listMemories(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/memories${query.size ? `?${query}` : ""}`
    );
  }

  createMemory(memory) {
    return this.request("POST", "/api/v1/memories", memory);
  }

  updateMemory(id, changes) {
    return this.request(
      "PATCH",
      `/api/v1/memories/${encodeURIComponent(id)}`,
      changes
    );
  }

  confirmMemory(id) {
    return this.request(
      "POST",
      `/api/v1/memories/${encodeURIComponent(id)}/confirm`,
      {}
    );
  }

  deleteMemory(id) {
    return this.request("DELETE", `/api/v1/memories/${encodeURIComponent(id)}`);
  }

  recallMemories(query) {
    return this.request("POST", "/api/v1/memories/recall", { query });
  }

  extractMemories(payload) {
    return this.request("POST", "/api/v1/memories/extract", payload);
  }

  consolidateMemories() {
    return this.request("POST", "/api/v1/memories/consolidate", {});
  }

  getMemorySettings() {
    return this.request("GET", "/api/v1/memories/settings");
  }

  saveMemorySettings(settings) {
    return this.request("PUT", "/api/v1/memories/settings", settings);
  }

  getPromptSettings() {
    return this.request("GET", "/api/v1/prompt-settings");
  }

  savePromptSettings(settings) {
    return this.request("PUT", "/api/v1/prompt-settings", settings);
  }

  listPromptVersions() {
    return this.request("GET", "/api/v1/prompt-settings/versions");
  }

  restorePromptVersion(version) {
    return this.request(
      "POST",
      `/api/v1/prompt-settings/versions/${encodeURIComponent(version)}/restore`,
      {}
    );
  }

  getTimeAwarenessContext(input) {
    return this.request("POST", "/api/v1/time-awareness/context", input);
  }

  getXuanMoodHome() {
    return this.request("GET", "/api/v1/xuan-mood/home");
  }

  recordXuanMoodEvent(input) {
    return this.request("POST", "/api/v1/xuan-mood/events", input);
  }

  refreshXuanMood() {
    return this.request("POST", "/api/v1/xuan-mood/refresh", {});
  }

  listAlbumMoments(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/album/moments${query.size ? `?${query}` : ""}`
    );
  }

  createAlbumMoment(moment) {
    return this.request("POST", "/api/v1/album/moments", moment);
  }

  updateAlbumMoment(id, changes) {
    return this.request(
      "PATCH",
      `/api/v1/album/moments/${encodeURIComponent(id)}`,
      changes
    );
  }

  hideAlbumMoment(id) {
    return this.request(
      "POST",
      `/api/v1/album/moments/${encodeURIComponent(id)}/hide`,
      {}
    );
  }

  addAlbumMomentSource(id, source) {
    return this.request(
      "POST",
      `/api/v1/album/moments/${encodeURIComponent(id)}/sources`,
      source
    );
  }

  listAlbumSourceCandidates(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/album/source-candidates${query.size ? `?${query}` : ""}`
    );
  }

  listDreams(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request("GET", `/api/v1/dreams${query.size ? `?${query}` : ""}`);
  }

  listAssistantGallery(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/assistant/gallery${query.size ? `?${query}` : ""}`
    );
  }

  getDream(id) {
    return this.request("GET", `/api/v1/dreams/${encodeURIComponent(id)}`);
  }

  getDreamByDate(dreamDate) {
    return this.request(
      "GET",
      `/api/v1/dreams/by-date/${encodeURIComponent(dreamDate)}`
    );
  }

  getDreamMaterial(from, to, limit = 60) {
    const query = new URLSearchParams({
      from: String(from),
      to: String(to),
      limit: String(limit)
    });
    return this.request("GET", `/api/v1/dreams/material?${query}`);
  }

  createDream(input) {
    return this.request("POST", "/api/v1/dreams", input);
  }

  updateDream(id, changes) {
    return this.request("PATCH", `/api/v1/dreams/${encodeURIComponent(id)}`, changes);
  }

  deleteDream(id) {
    return this.request("DELETE", `/api/v1/dreams/${encodeURIComponent(id)}`);
  }

  listConversations() {
    return this.request("GET", "/api/v1/conversations");
  }

  createConversation(title) {
    return this.request("POST", "/api/v1/conversations", { title });
  }

  getConversation(id) {
    return this.request(
      "GET",
      `/api/v1/conversations/${encodeURIComponent(id)}`
    );
  }

  saveConversationMessages(id, messages) {
    return this.request(
      "PUT",
      `/api/v1/conversations/${encodeURIComponent(id)}/messages`,
      { messages }
    );
  }

  deleteConversation(id) {
    return this.request(
      "DELETE",
      `/api/v1/conversations/${encodeURIComponent(id)}`
    );
  }
}

module.exports = { XuanApiClient, ApiError };
