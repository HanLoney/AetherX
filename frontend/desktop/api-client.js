const { randomUUID } = require("node:crypto");

class ApiError extends Error {
  constructor(message, status = 0, code = "API_ERROR", requestId = "", details = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
    this.details = details;
  }
}

class XuanApiClient {
  constructor(options = {}) {
    this.setBaseUrl(options.baseUrl || "http://127.0.0.1:4318");
    this.token = String(options.token || "");
    this.refreshToken = String(options.refreshToken || "");
    this.onUnauthorized = options.onUnauthorized;
    this.onSessionChanged = options.onSessionChanged;
    this.onConnectionChanged = options.onConnectionChanged;
    this.routePromise = null;
    this.refreshPromise = null;
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

  setRefreshToken(refreshToken) {
    this.refreshToken = String(refreshToken || "");
  }

  async request(method, path, body) {
    const controller = new AbortController();
    const timeout = requestTimeoutForPath(path);
    const timer = setTimeout(() => controller.abort(), timeout);
    const requestId = isWriteMethod(method) ? randomUUID() : "";
    try {
      return await this.performRequest(
        method,
        path,
        body,
        controller.signal,
        requestId,
        true
      );
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

  async performRequest(method, path, body, signal, requestId, allowRoute, retryCount = 0, allowRefresh = true) {
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
    const payload = response.status === 204
      ? { data: null }
      : await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new ApiError(
        payload?.error?.message || `后端请求失败（HTTP ${response.status}）`,
        response.status,
        payload?.error?.code || "API_ERROR",
        payload?.requestId || "",
        payload?.error?.details || null
      );
      if (
        retryCount < 3 &&
        isRetryableHubRead(method, response.status, error.code)
      ) {
        await waitForHubReadRetry(retryCount);
        return this.performRequest(
          method,
          path,
          body,
          signal,
          requestId,
          allowRoute,
          retryCount + 1,
          allowRefresh
        );
      }
      if (
        allowRoute &&
        response.status === 409 &&
        error.code === "HUB_NOT_ACTIVE" &&
        path !== "/api/v1/cluster/session-handoff" &&
        await this.routeToActiveHub(signal)
      ) {
        return this.performRequest(method, path, body, signal, requestId, false, retryCount, allowRefresh);
      }
      if (
        allowRefresh &&
        response.status === 401 &&
        path !== "/api/v1/auth/refresh" &&
        await this.refreshAccessSession(signal)
      ) {
        return this.performRequest(method, path, body, signal, requestId, allowRoute, retryCount, false);
      }
      if (response.status === 401 && typeof this.onUnauthorized === "function") {
        this.onUnauthorized(error);
      }
      throw error;
    }
    return hydrateMediaSources(payload.data, this.baseUrl, this.token);
  }

  async refreshAccessSession(signal) {
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
      if (!response.ok || !payload?.data?.token || !payload?.data?.refreshToken) return false;
      this.token = payload.data.token;
      this.refreshToken = payload.data.refreshToken;
      this.onSessionChanged?.(payload.data);
      return true;
    })().finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async routeToActiveHub(signal) {
    if (!this.token) return false;
    if (this.routePromise) return this.routePromise;
    this.routePromise = (async () => {
      const response = await fetch(`${this.baseUrl}/api/v1/cluster/session-handoff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          "X-Request-Id": randomUUID()
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
        throw new ApiError(
          "活动 Hub 返回了无效的会话交接结果。",
          502,
          "HUB_HANDOFF_INVALID"
        );
      }
      this.setBaseUrl(baseUrl);
      this.setToken(handoff.token);
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
    })().finally(() => {
      this.routePromise = null;
    });
    return this.routePromise;
  }

  async ensureActiveHub(signal) {
    const status = await this.getClusterStatus(signal);
    if (status.localNodeId !== status.activeNodeId) {
      await this.routeToActiveHub(signal);
      return this.getClusterStatus(signal);
    }
    return status;
  }

  getClusterStatus(signal) {
    return this.request("GET", "/api/v1/cluster/status", undefined, signal);
  }

  getHubDivergence(limit = 200, offset = 0) {
    const query = new URLSearchParams({
      limit: String(limit),
      offset: String(offset)
    });
    return this.request("GET", `/api/v1/cluster/divergence?${query}`);
  }

  exportHubDivergenceEvidence() {
    return this.request("GET", "/api/v1/cluster/divergence/evidence");
  }

  recoverHubDivergence(authority) {
    return this.request("POST", "/api/v1/cluster/divergence/recover", { authority });
  }

  listMobileHubs() {
    return this.request("GET", "/api/v1/cluster/mobile-hubs");
  }

  synchronizeMobileHub(nodeId, endpoints = []) {
    return this.request(
      "POST",
      `/api/v1/cluster/mobile-hubs/${encodeURIComponent(nodeId)}/synchronize`,
      { endpoints }
    );
  }

  switchMobileHub(nodeId, endpoints = []) {
    return this.request(
      "POST",
      `/api/v1/cluster/mobile-hubs/${encodeURIComponent(nodeId)}/switch`,
      { endpoints }
    );
  }

  discoverMobileHubEndpoint(nodeId, endpoint) {
    return this.request(
      "POST",
      `/api/v1/cluster/mobile-hubs/${encodeURIComponent(nodeId)}/discover-endpoint`,
      { endpoint }
    );
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

  verifyEmail(token, session = {}) {
    return this.request("POST", "/api/v1/auth/email/verify", { token, ...session });
  }

  resendEmailVerification(input) {
    return this.request("POST", "/api/v1/auth/email/resend", input);
  }

  requestPasswordReset(email) {
    return this.request("POST", "/api/v1/auth/password/forgot", { email });
  }

  resetPassword(input) {
    return this.request("POST", "/api/v1/auth/password/reset", input);
  }

  getSession() {
    return this.request("GET", "/api/v1/auth/session");
  }

  logout() {
    return this.request("POST", "/api/v1/auth/logout");
  }

  analyticsPresence(input) {
    return this.request("POST", "/api/v1/analytics/presence", input);
  }

  analyticsEvents(events) {
    return this.request("POST", "/api/v1/analytics/events", { events });
  }

  createPairingSession(input = {}) {
    return this.request("POST", "/api/v1/pairing/sessions", input);
  }

  getPairingSession(id) {
    return this.request(
      "GET",
      `/api/v1/pairing/sessions/${encodeURIComponent(id)}`
    );
  }

  approvePairingSession(id) {
    return this.request(
      "POST",
      `/api/v1/pairing/sessions/${encodeURIComponent(id)}/approve`,
      {}
    );
  }

  createHubPairingSession(input = {}) {
    return this.request("POST", "/api/v1/hub-pairing/sessions", input);
  }

  getHubPairingSession(id) {
    return this.request(
      "GET",
      `/api/v1/hub-pairing/sessions/${encodeURIComponent(id)}`
    );
  }

  approveHubPairingSession(id) {
    return this.request(
      "POST",
      `/api/v1/hub-pairing/sessions/${encodeURIComponent(id)}/approve`,
      {}
    );
  }

  listDevices() {
    return this.request("GET", "/api/v1/devices");
  }

  revokeDevice(id) {
    return this.request("DELETE", `/api/v1/devices/${encodeURIComponent(id)}`);
  }

  deleteDeviceRecord(id) {
    return this.request("DELETE", `/api/v1/devices/${encodeURIComponent(id)}/record`);
  }

  listSyncChanges(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/sync/changes${query.size ? `?${query}` : ""}`
    );
  }

  createArchiveExport(password, secretPolicy = "excluded") {
    return this.request("POST", "/api/v1/archives/export", { password, secretPolicy });
  }

  archiveDownloadUrl(downloadPath) {
    const value = String(downloadPath || "");
    if (!value.startsWith("/api/v1/archives/download/")) {
      throw new ApiError("存档下载地址无效。", 400, "ARCHIVE_DOWNLOAD_INVALID");
    }
    return `${this.baseUrl}${value}`;
  }

  async restoreArchive(body, password) {
    let response;
    try {
      response = await fetch(`${this.baseUrl}/api/v1/archives/restore`, {
        method: "POST",
        headers: {
          "Content-Type": "application/vnd.aetherx.archive",
          "X-AetherX-Archive-Password": Buffer.from(String(password || ""), "utf8").toString("base64"),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {})
        },
        body,
        duplex: "half"
      });
    } catch (error) {
      throw new ApiError(`无法连接 AetherX 后端：${error.message}`, 0, "BACKEND_UNAVAILABLE");
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ApiError(
        payload?.error?.message || `导入存档失败（HTTP ${response.status}）。`,
        response.status,
        payload?.error?.code,
        payload?.requestId
      );
    }
    return payload.data;
  }

  getAiConfig() {
    return this.request("GET", "/api/v1/ai/config");
  }

  saveAiConfig(config) {
    return this.request("PUT", "/api/v1/ai/config", config);
  }

  listAiProviders() {
    return this.request("GET", "/api/v1/ai/providers");
  }

  saveAiProvider(config) {
    return this.request(
      "PUT",
      `/api/v1/ai/providers/${encodeURIComponent(config.providerId)}`,
      config
    );
  }

  testAiProvider(config) {
    return this.request(
      "POST",
      `/api/v1/ai/providers/${encodeURIComponent(config.providerId)}/test`,
      config
    );
  }

  listAiProviderModels(config) {
    return this.request(
      "POST",
      `/api/v1/ai/providers/${encodeURIComponent(config.providerId)}/models`,
      config
    );
  }

  activateAiProvider(providerId) {
    return this.request(
      "POST",
      `/api/v1/ai/providers/${encodeURIComponent(providerId)}/activate`,
      {}
    );
  }

  listProviderIntegrations() {
    return this.request("GET", "/api/v1/ai/provider-integrations");
  }

  startProviderOAuth(integrationId) {
    return this.request(
      "POST",
      `/api/v1/ai/provider-integrations/${encodeURIComponent(integrationId)}/oauth/start`,
      {}
    );
  }

  providerOAuthStatus(integrationId, flowId) {
    return this.request(
      "GET",
      `/api/v1/ai/provider-integrations/${encodeURIComponent(integrationId)}/oauth/status/${encodeURIComponent(flowId)}`
    );
  }

  listBillingModules() {
    return this.request("GET", "/api/v1/billing/modules");
  }

  getBillingBalance(moduleId) {
    return this.request("GET", `/api/v1/billing/modules/${encodeURIComponent(moduleId)}/balance`);
  }

  createBillingPaymentSession(moduleId, amount) {
    return this.request("POST", `/api/v1/billing/modules/${encodeURIComponent(moduleId)}/payment-sessions`, { amount });
  }

  getBillingPaymentStatus(moduleId, sessionId) {
    return this.request("GET", `/api/v1/billing/modules/${encodeURIComponent(moduleId)}/payment-sessions/${encodeURIComponent(sessionId)}`);
  }

  requestAi(payload) {
    return this.request("POST", "/api/v1/ai/chat", payload);
  }

  agentChat(payload) {
    return this.request("POST", "/api/v1/agent/chat", payload);
  }

  approveAgentRun(id, approved) {
    return this.request(
      "POST",
      `/api/v1/agent/runs/${encodeURIComponent(id)}/approve`,
      { approved: approved === true }
    );
  }

  getAgentPermissions() {
    return this.request("GET", "/api/v1/agent/permissions");
  }

  updateAgentPermissions(input) {
    return this.request("PUT", "/api/v1/agent/permissions", {
      autoApproveWrites: input?.autoApproveWrites === true
    });
  }

  listModules() {
    return this.request("GET", "/api/v1/modules");
  }

  updateModule(id, enabled) {
    return this.request(
      "PATCH",
      `/api/v1/modules/${encodeURIComponent(id)}`,
      { enabled: enabled === true }
    );
  }

  listModuleActivity(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/modules/activity${query.size ? `?${query}` : ""}`
    );
  }

  recordModuleActivity(input) {
    return this.request("POST", "/api/v1/modules/activity", input);
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

  getWalletSummary() {
    return this.request("GET", "/api/v1/wallet");
  }

  listWalletTransactions(id, filters = {}) {
    const query = new URLSearchParams();
    if (filters.limit !== undefined) query.set("limit", String(filters.limit));
    const suffix = query.size ? `?${query.toString()}` : "";
    return this.request(
      "GET",
      `/api/v1/wallet/accounts/${encodeURIComponent(id)}/transactions${suffix}`
    );
  }

  updateWalletTransaction(accountId, transactionId, changes) {
    return this.request(
      "PATCH",
      `/api/v1/wallet/accounts/${encodeURIComponent(accountId)}/transactions/${encodeURIComponent(transactionId)}`,
      changes
    );
  }

  createWalletAccount(input) {
    return this.request("POST", "/api/v1/wallet/accounts", input);
  }

  updateWalletAccount(id, changes) {
    return this.request(
      "PATCH",
      `/api/v1/wallet/accounts/${encodeURIComponent(id)}`,
      changes
    );
  }

  adjustWalletAccount(id, input) {
    return this.request(
      "POST",
      `/api/v1/wallet/accounts/${encodeURIComponent(id)}/adjust`,
      input
    );
  }

  deleteWalletAccount(id) {
    return this.request(
      "DELETE",
      `/api/v1/wallet/accounts/${encodeURIComponent(id)}`
    );
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

  getAssistantGallerySummary(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/assistant/gallery/summary${query.size ? `?${query}` : ""}`
    );
  }

  getAssistantGalleryPage(filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/assistant/gallery/page${query.size ? `?${query}` : ""}`
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

  getConversationMessage(id, messageId) {
    return this.request(
      "GET",
      `/api/v1/conversations/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`
    );
  }

  getConversationMessagePage(id, filters = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== undefined && value !== "")
    );
    return this.request(
      "GET",
      `/api/v1/conversations/${encodeURIComponent(id)}/message-page${query.size ? `?${query}` : ""}`
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

function requestTimeoutForPath(path) {
  const value = String(path || "");
  if (value.includes("/agent/") ||
      /^\/api\/v1\/cluster\/mobile-hubs\/[^/]+\/switch(?:\?|$)/.test(value)) {
    return 300_000;
  }
  if (value.includes("/ai/image-generations")) return 245_000;
  if (/^\/api\/v1\/(?:profile|assistant\/(?:profile|personality-events|journals|gallery))(?:[/?]|$)/.test(value)) {
    return 15_000;
  }
  return 65_000;
}

function hydrateMediaSources(value, baseUrl, token) {
  if (Array.isArray(value)) {
    value.forEach((item) => hydrateMediaSources(item, baseUrl, token));
    return value;
  }
  if (!value || typeof value !== "object") return value;
  if (typeof value.mediaId === "string" && value.mediaId) {
    const mediaUrl = `${baseUrl}/api/v1/media/${encodeURIComponent(value.mediaId)}`;
    const auth = token ? `&access_token=${encodeURIComponent(token)}` : "";
    value.source = `${mediaUrl}?variant=preview${auth}`;
    value.originalSource = `${mediaUrl}${token ? `?access_token=${encodeURIComponent(token)}` : ""}`;
  }
  Object.values(value).forEach((item) => hydrateMediaSources(item, baseUrl, token));
  return value;
}

function normalizeServerUrl(value) {
  const result = String(value || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(result) ? result : "";
}

function isWriteMethod(method) {
  return !["GET", "HEAD", "OPTIONS"].includes(String(method || "").toUpperCase());
}

function isRetryableHubRead(method, status, code) {
  return ["GET", "HEAD"].includes(String(method || "").toUpperCase()) &&
    Number(status) === 503 &&
    [
      "LOCAL_HUB_BUSY",
      "LOCAL_HUB_RUNTIME_UNAVAILABLE",
      "LOCAL_HUB_REQUEST_FAILED"
    ].includes(String(code || ""));
}

function waitForHubReadRetry(attempt) {
  const delayMs = [250, 600, 1200][Math.min(Math.max(Number(attempt) || 0, 0), 2)];
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

module.exports = { XuanApiClient, ApiError, requestTimeoutForPath };
