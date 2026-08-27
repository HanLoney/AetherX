import { computed, readonly, ref } from "vue";
import { Capacitor } from "@capacitor/core";
import {
  AetherApi,
  type AuthConfig,
  type AuthUser,
  type ClusterStatus,
  type HubConnectionChange
} from "../lib/api";
import {
  clearHubRouting,
  clearSession,
  loadHubRouting,
  loadServerUrl,
  loadSession,
  saveHubRouting,
  saveServerUrl,
  saveSession,
  type StoredHubRouting
} from "../lib/storage";
import { LocalHubClient } from "../lib/local-hub-client";
import { useLocalHub } from "../lib/local-hub";
import { hubRouteCandidates } from "../lib/hub-route";

const ready = ref(false);
const busy = ref(false);
const user = ref<AuthUser | null>(null);
const serverUrl = ref("");
const spaceId = ref("");
const localNodeId = ref("");
const activeNodeId = ref("");
const epoch = ref(0);
const hubRole = ref<"active" | "standby" | "unknown">("unknown");
const routing = ref<StoredHubRouting | null>(null);
const error = ref("");
let api: AetherApi | null = null;
let bootstrapPromise: Promise<void> | null = null;
let discoveredHubRecovery: Promise<void> | null = null;
let discoveryListenerRegistered = false;

function createApi(
  url: string,
  token = "",
  invalidateOnUnauthorized = true,
  routeChanges = true,
  refreshToken = ""
) {
  let instance: AetherApi;
  instance = new AetherApi({
    baseUrl: url,
    token,
    refreshToken,
    ...(invalidateOnUnauthorized ? { onUnauthorized: () => void invalidate() } : {}),
    onSessionChanged: async (session) => {
      if (api !== instance) return;
      user.value = session.user;
      await saveSession({
        token: session.token,
        refreshToken: session.refreshToken,
        user: session.user
      });
    },
    ...(routeChanges ? { onConnectionChanged: (connection: HubConnectionChange) => applyRoutedConnection(instance, connection) } : {})
  });
  return instance;
}

async function bootstrap() {
  registerDiscoveredHubRecovery();
  if (ready.value) return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    routing.value = await loadHubRouting();
    serverUrl.value = await loadServerUrl();
    const stored = await loadSession();
    if (stored?.token && stored.user.email) {
      api = createApi(serverUrl.value, stored.token, true, true, stored.refreshToken || "");
      user.value = stored.user;
      try {
        const current = await api.session();
        user.value = current.user;
        await saveSession({
          token: api.accessToken,
          refreshToken: api.sessionRefreshToken,
          user: current.user
        });
      } catch {
        await invalidate();
      }
      ready.value = true;
      return;
    }
    const local = useLocalHub().status.value;
    if (
      stored?.user &&
      local?.configured &&
      local.role === "active" &&
      local.bootstrap?.status === "completed"
    ) {
      api = new LocalHubClient(stored.user);
      user.value = stored.user;
      serverUrl.value = "capacitor://local-hub";
      spaceId.value = local.spaceId;
      localNodeId.value = local.localNodeId;
      activeNodeId.value = local.activeNodeId;
      epoch.value = local.epoch;
      hubRole.value = "active";
      ready.value = true;
      return;
    }
    const preferred = routing.value?.nodes.find(
      (node) => node.nodeId === routing.value?.activeNodeId
    );
    if (preferred?.serverUrl && preferred.token) serverUrl.value = preferred.serverUrl;
    if (stored?.token) {
      api = createApi(serverUrl.value, preferred?.token || stored.token);
      user.value = stored.user;
      await validateStoredSession(api, stored, preferred || {
        nodeId: routing.value?.activeNodeId || "",
        serverUrl: serverUrl.value,
        token: stored.token,
        lastSeenAt: 0
      });
    } else {
      api = createApi(serverUrl.value);
    }
    ready.value = true;
  })().finally(() => { bootstrapPromise = null; });
  return bootstrapPromise;
}

function registerDiscoveredHubRecovery() {
  if (discoveryListenerRegistered) return;
  discoveryListenerRegistered = true;
  window.addEventListener("aetherx:peer-endpoint-discovered", (event) => {
    const detail = (event as CustomEvent<{ nodeId?: string; address?: string }>).detail;
    if (!detail?.nodeId || !detail.address || discoveredHubRecovery) return;
    discoveredHubRecovery = recoverDiscoveredHub(detail.nodeId, detail.address)
      .catch(() => undefined)
      .finally(() => { discoveredHubRecovery = null; });
  });
}

async function recoverDiscoveredHub(nodeId: string, address: string) {
  if (api instanceof LocalHubClient) return;
  if (shouldAvoidInsecureAndroidRoute(address)) return;
  if (api && normalizeRouteUrl(api.serverUrl) === normalizeRouteUrl(address)) return;
  const route = routing.value?.nodes.find((item) => item.nodeId === nodeId);
  if (!route?.token || !user.value) return;
  const candidate = createApi(address, route.token, false);
  const connection = await validateHubConnection(candidate, user.value);
  if (
    connection.status.localNodeId !== nodeId ||
    connection.status.activeNodeId !== nodeId
  ) return;
  await applyRoutedConnection(candidate, {
    baseUrl: candidate.serverUrl,
    token: route.token,
    user: connection.user,
    spaceId: connection.status.spaceId,
    nodeId: connection.status.localNodeId,
    activeNodeId: connection.status.activeNodeId,
    epoch: connection.status.epoch
  });
}

async function validateStoredSession(
  candidate: AetherApi,
  stored: { token: string; user: AuthUser },
  route: StoredHubRouting["nodes"][number]
) {
  const insecureAndroidRoute = shouldAvoidInsecureAndroidRoute(candidate.serverUrl);
  try {
    if (insecureAndroidRoute) {
      throw new Error("Waiting for a secure discovered Hub endpoint.");
    }
    const connection = await validateHubConnection(candidate, stored.user);
    await rememberCluster(candidate, connection.status);
    if (api !== candidate) return;
    user.value = connection.user;
    await saveSession({ token: candidate.accessToken || stored.token, user: connection.user });
  } catch {
    try {
      const recovered = await connectStoredHub(route, stored.user, candidate.serverUrl);
      if (api !== candidate) return;
      api = recovered.api;
      serverUrl.value = recovered.api.serverUrl;
      user.value = recovered.user;
      await rememberCluster(recovered.api, recovered.status);
      await Promise.all([
        saveServerUrl(recovered.api.serverUrl),
        saveSession({ token: recovered.api.accessToken || stored.token, user: recovered.user })
      ]);
      window.dispatchEvent(new CustomEvent("aetherx:hub-routed", {
        detail: {
          spaceId: recovered.status.spaceId,
          nodeId: recovered.status.localNodeId,
          epoch: recovered.status.epoch,
          recovered: true
        }
      }));
    } catch {
      // Keep cached data available while all saved Hub endpoints are unreachable.
    }
    if (insecureAndroidRoute && api === candidate) {
      api = null;
      serverUrl.value = "";
    }
    // 网络中断时继续使用本地缓存；真正的 401 会由 API 统一触发退出。
  }
}

async function login(input: { serverUrl: string; username?: string; email?: string; password: string }) {
  busy.value = true;
  error.value = "";
  try {
    const candidate = createApi(input.serverUrl);
    await candidate.health();
    const result = await candidate.login({
      ...(input.email ? { email: input.email } : { username: input.username }),
      password: input.password
    });
    await establishAuthenticatedSession(candidate, result.token, result.user, result.refreshToken || "");
    return result.user;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "没有成功连接到 AetherX。";
    throw cause;
  } finally {
    busy.value = false;
  }
}

async function register(input: {
  serverUrl: string;
  username?: string;
  email?: string;
  displayName: string;
  password: string;
  registrationSecret?: string;
}) {
  busy.value = true;
  error.value = "";
  try {
    const candidate = createApi(input.serverUrl);
    await candidate.health();
    const result = await candidate.register({
      ...(input.email ? { email: input.email } : { username: input.username }),
      displayName: input.displayName,
      password: input.password,
      registrationSecret: input.registrationSecret
    });
    if (result.verificationRequired) return result;
    if (!result.token || !result.user) throw new Error("账号创建结果不完整，请重新尝试。");
    await establishAuthenticatedSession(candidate, result.token, result.user);
    return result;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "账号没有创建成功。";
    throw cause;
  } finally {
    busy.value = false;
  }
}

async function verifyEmail(input: { serverUrl: string; token: string }) {
  busy.value = true;
  error.value = "";
  try {
    const candidate = createApi(input.serverUrl);
    await candidate.health();
    const result = await candidate.verifyEmail(input.token);
    await establishAuthenticatedSession(candidate, result.token, result.user, result.refreshToken || "");
    return result.user;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "邮箱验证没有成功。";
    throw cause;
  } finally {
    busy.value = false;
  }
}

async function resendEmailVerification(input: { serverUrl: string; email: string; password: string }) {
  const candidate = createApi(input.serverUrl);
  await candidate.health();
  return candidate.resendEmailVerification({ email: input.email, password: input.password });
}

function clearError() {
  error.value = "";
}

async function requestPasswordReset(input: { serverUrl: string; email: string }) {
  busy.value = true;
  error.value = "";
  try {
    const candidate = createApi(input.serverUrl);
    await candidate.health();
    return await candidate.requestPasswordReset(input.email);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "密码重置邮件暂时没有发送成功。";
    throw cause;
  } finally {
    busy.value = false;
  }
}

async function resetPassword(input: { serverUrl: string; token: string; password: string }) {
  busy.value = true;
  error.value = "";
  try {
    const candidate = createApi(input.serverUrl);
    await candidate.health();
    return await candidate.resetPassword({ token: input.token, password: input.password });
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "密码重置没有完成。";
    throw cause;
  } finally {
    busy.value = false;
  }
}

async function inspectRegistration(server: string): Promise<AuthConfig> {
  const candidate = createApi(server);
  await candidate.health();
  return candidate.authConfig();
}

async function establishAuthenticatedSession(
  candidate: AetherApi,
  token: string,
  authenticatedUser: AuthUser,
  refreshToken = ""
) {
  api = createApi(candidate.serverUrl, token, true, true, refreshToken);
  user.value = authenticatedUser;
  serverUrl.value = api.serverUrl;
  await Promise.all([
    saveServerUrl(serverUrl.value),
    saveSession({ token, refreshToken, user: authenticatedUser })
  ]);
  if (authenticatedUser.email) {
    routing.value = null;
    spaceId.value = "";
    localNodeId.value = "";
    activeNodeId.value = "";
    epoch.value = 1;
    hubRole.value = "active";
    await clearHubRouting();
    const current = await api.session();
    user.value = current.user;
    await saveSession({
      token: api.accessToken,
      refreshToken: api.sessionRefreshToken,
      user: current.user
    });
    return;
  }
  const status = await api.ensureActiveHub();
  await rememberCluster(api, status);
  const current = await api.session();
  user.value = current.user;
  serverUrl.value = api.serverUrl;
  await Promise.all([
    saveServerUrl(serverUrl.value),
    saveSession({
      token: api.accessToken,
      refreshToken: api.sessionRefreshToken,
      user: current.user
    })
  ]);
}

async function pair(code: string) {
  busy.value = true;
  error.value = "";
  try {
    const payload = parsePairingCode(code);
    const candidate = createApi(payload.serverUrl, "", false);
    await candidate.health();
    try {
      await candidate.claimPairingSession(payload.id, {
        secret: payload.secret,
        deviceName: androidDeviceName()
      });
    } catch (cause) {
      const alreadyRedeemed = cause instanceof Error &&
        "code" in cause && cause.code === "PAIRING_STATE_CONFLICT";
      if (
        alreadyRedeemed &&
        api?.accessToken &&
        normalizeRouteUrl(api.serverUrl) === normalizeRouteUrl(payload.serverUrl)
      ) {
        const current = await api.session();
        user.value = current.user;
        serverUrl.value = api.serverUrl;
        return current.user;
      }
      throw cause;
    }
    const deadline = Math.min(payload.expiresAt || Date.now() + 120_000, Date.now() + 10 * 60_000);
    let redeemed: Awaited<ReturnType<AetherApi["redeemPairingSession"]>> | null = null;
    while (Date.now() < deadline) {
      try {
        redeemed = await candidate.redeemPairingSession(payload.id, payload.secret);
        break;
      } catch (cause) {
        if (!(cause instanceof Error) || !("code" in cause) || cause.code !== "PAIRING_STATE_CONFLICT") throw cause;
        await delay(1_500);
      }
    }
    if (!redeemed) throw new Error("配对等待已经结束，请在电脑端重新生成连接码。 ");
    const authenticated = createApi(payload.serverUrl, redeemed.token, false);
    const current = await authenticated.session();
    await establishAuthenticatedSession(authenticated, redeemed.token, current.user);
    return current.user;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "没有完成设备配对。";
    throw cause;
  } finally {
    busy.value = false;
  }
}

async function reconnect(nextServerUrl: string) {
  if (!api || !user.value || !api.accessToken) {
    throw new Error("登录状态已失效，请重新登录。 ");
  }
  busy.value = true;
  error.value = "";
  const previousUser = user.value;
  const savedRoute = routing.value?.nodes.find(
    (node) => normalizeRouteUrl(node.serverUrl) === normalizeRouteUrl(nextServerUrl)
  );
  const token = savedRoute?.token || api.accessToken;
  try {
    const candidate = createApi(nextServerUrl, token, false);
    const current = await withConnectionTimeout(async (signal) => {
      await candidate.health(signal);
      try {
        return await candidate.session(signal);
      } catch (cause) {
        if (cause instanceof Error && "status" in cause && cause.status === 401) {
          throw new Error("当前凭证不能连接这台 Hub，请改用电脑端的新配对码。 ");
        }
        throw cause;
      }
    });
    if (authUserIdentity(current.user) !== authUserIdentity(previousUser)) {
      throw new Error("这台 Hub 返回了另一个账号，请使用新的配对码确认连接。 ");
    }
    await establishAuthenticatedSession(candidate, token, current.user);
    return current.user;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "没有成功重新连接 Hub。";
    throw cause;
  } finally {
    busy.value = false;
  }
}

async function refreshCurrentUser() {
  if (!api || !user.value || !api.accessToken) return null;
  const current = await api.session();
  user.value = current.user;
  await saveSession({
    token: api.accessToken,
    refreshToken: api.sessionRefreshToken,
    user: current.user
  });
  return current.user;
}

async function activateLocalHub() {
  return activateLocalHubMode(false);
}

async function forceActivateLocalHub() {
  return activateLocalHubMode(true);
}

async function activateLocalHubMode(force: boolean) {
  const currentUser = user.value;
  if (!currentUser) throw new Error("登录状态已失效，请重新登录。 ");
  busy.value = true;
  error.value = "";
  try {
    const localHub = useLocalHub();
    let local = await localHub.refresh();
    if (force) {
      await localHub.forceTakeover();
      local = localHub.status.value;
    } else if (local?.role !== "active" || local.state !== "stable") {
      await localHub.switchToLocal();
      local = localHub.status.value;
    }
    if (!local || local.role !== "active" || !["stable", "forced_active"].includes(local.state)) {
      throw new Error("手机 Hub 尚未完成安全切换。 ");
    }
    api = new LocalHubClient(currentUser);
    serverUrl.value = "capacitor://local-hub";
    spaceId.value = local.spaceId;
    localNodeId.value = local.localNodeId;
    activeNodeId.value = local.activeNodeId;
    epoch.value = local.epoch;
    hubRole.value = "active";
    if (routing.value) {
      routing.value = {
        ...routing.value,
        activeNodeId: local.activeNodeId,
        localNodeId: local.localNodeId,
        epoch: local.epoch
      };
      await saveHubRouting(routing.value);
    }
    window.dispatchEvent(new CustomEvent("aetherx:hub-routed", {
      detail: {
        spaceId: local.spaceId,
        nodeId: local.localNodeId,
        epoch: local.epoch,
        local: true
      }
    }));
    return local;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "没有成功切换到手机 Hub。";
    throw cause;
  } finally {
    busy.value = false;
  }
}

async function activateDesktopHub() {
  const currentUser = user.value;
  if (!currentUser) throw new Error("登录状态已失效，请重新登录。 ");
  busy.value = true;
  error.value = "";
  try {
    const localHub = useLocalHub();
    const local = await localHub.refresh();
    const switched = local?.role === "standby" && local.state === "stable"
      ? { completed: true, activeNodeId: local.activeNodeId, epoch: local.epoch, state: local.state }
      : await localHub.switchToPeer();
    const route = routing.value?.nodes.find((node) => node.nodeId === switched.activeNodeId);
    if (!route?.serverUrl || !route.token) {
      throw new Error("电脑 Hub 已接管，但手机缺少可用的登录凭证，请重新配对连接。 ");
    }
    const connection = await connectStoredHub(route, currentUser);
    const candidate = connection.api;
    const current = { user: connection.user };
    if (authUserIdentity(current.user) !== authUserIdentity(currentUser)) {
      throw new Error("电脑 Hub 返回了另一个账号，请重新配对。 ");
    }
    await establishAuthenticatedSession(candidate, route.token, current.user);
    window.dispatchEvent(new CustomEvent("aetherx:hub-routed", {
      detail: {
        spaceId: spaceId.value,
        nodeId: localNodeId.value,
        epoch: epoch.value,
        local: false
      }
    }));
    return switched;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "没有成功切换到电脑 Hub。";
    throw cause;
  } finally {
    busy.value = false;
  }
}

async function logout() {
  try { await api?.logout(); } catch { /* 本地退出不依赖网络 */ }
  await invalidate();
}

async function invalidate() {
  user.value = null;
  if (serverUrl.value) api = createApi(serverUrl.value);
  await clearSession();
  await clearHubRouting();
  routing.value = null;
  spaceId.value = "";
  localNodeId.value = "";
  activeNodeId.value = "";
  epoch.value = 0;
  hubRole.value = "unknown";
  window.dispatchEvent(new CustomEvent("aetherx:session-invalidated"));
  if (window.location.hash !== "#/login") window.location.hash = "#/login";
}

function requireApi() {
  if (!api || !user.value) throw new Error("登录状态已失效，请重新登录。 ");
  return api;
}

async function createDesktopControlConnection() {
  const currentLocalNodeId = useLocalHub().status.value?.localNodeId || localNodeId.value;
  const route = [...(routing.value?.nodes || [])]
    .filter((node) =>
      node.nodeId !== currentLocalNodeId &&
      /^https?:\/\//i.test(node.serverUrl) &&
      Boolean(node.token)
    )
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)[0];
  if (!route) return null;
  const connection = await connectStoredHub(route, user.value, "", false);
  return { nodeId: route.nodeId, api: connection.api };
}

export function useSessionStore() {
  return {
    ready: readonly(ready),
    busy: readonly(busy),
    user: readonly(user),
    serverUrl: readonly(serverUrl),
    spaceId: readonly(spaceId),
    localNodeId: readonly(localNodeId),
    activeNodeId: readonly(activeNodeId),
    epoch: readonly(epoch),
    hubRole: readonly(hubRole),
    routing: readonly(routing),
    error: readonly(error),
    authenticated: computed(() => Boolean(user.value)),
    bootstrap,
    login,
    register,
    verifyEmail,
    resendEmailVerification,
    clearError,
    requestPasswordReset,
    resetPassword,
    inspectRegistration,
    pair,
    reconnect,
    activateLocalHub,
    forceActivateLocalHub,
    activateDesktopHub,
    refreshCurrentUser,
    logout,
    requireApi,
    createDesktopControlConnection
  };
}

async function applyRoutedConnection(candidate: AetherApi, connection: HubConnectionChange) {
  api = candidate;
  serverUrl.value = connection.baseUrl;
  user.value = connection.user;
  spaceId.value = connection.spaceId;
  localNodeId.value = connection.nodeId;
  activeNodeId.value = connection.activeNodeId;
  epoch.value = connection.epoch;
  hubRole.value = connection.nodeId === connection.activeNodeId ? "active" : "standby";
  await rememberNode({
    nodeId: connection.nodeId,
    serverUrl: connection.baseUrl,
    token: connection.token,
    lastSeenAt: Date.now()
  });
  await Promise.all([
    saveServerUrl(connection.baseUrl),
    saveSession({ token: connection.token, user: connection.user })
  ]);
  window.dispatchEvent(new CustomEvent("aetherx:hub-routed", {
    detail: { spaceId: connection.spaceId, nodeId: connection.nodeId, epoch: connection.epoch }
  }));
}

async function rememberCluster(candidate: AetherApi, status: ClusterStatus) {
  spaceId.value = status.spaceId;
  localNodeId.value = status.localNodeId;
  activeNodeId.value = status.activeNodeId;
  epoch.value = Number(status.epoch);
  hubRole.value = status.localRole;
  await rememberNode({
    nodeId: status.localNodeId,
    serverUrl: candidate.serverUrl,
    token: candidate.accessToken,
    lastSeenAt: Date.now()
  });
}

async function rememberNode(node: StoredHubRouting["nodes"][number]) {
  const existing = routing.value;
  const nodes = [
    node,
    ...(existing?.nodes || []).filter((item) => item.nodeId !== node.nodeId)
  ].slice(0, 4);
  routing.value = {
    spaceId: spaceId.value || existing?.spaceId || "",
    activeNodeId: activeNodeId.value || existing?.activeNodeId || node.nodeId,
    localNodeId: localNodeId.value || node.nodeId,
    epoch: epoch.value || existing?.epoch || 1,
    nodes
  };
  await saveHubRouting(routing.value);
}

function normalizeRouteUrl(value: string) {
  return String(value || "").trim().replace(/\/+$/, "").toLocaleLowerCase();
}

async function connectStoredHub(
  route: StoredHubRouting["nodes"][number],
  expectedUser: AuthUser | null,
  excludedUrl = "",
  routeChanges = true
) {
  const localHub = useLocalHub();
  const localStatus = await discoverPeerEndpoints(localHub, route.nodeId);
  const peerEndpoints = localStatus?.peerEndpoints || [];
  const candidates = hubRouteCandidates(route, peerEndpoints)
    .filter((url) => normalizeRouteUrl(url) !== normalizeRouteUrl(excludedUrl));
  const secureCandidates = localHub.available && typeof location !== "undefined" && location.protocol === "https:"
    ? candidates.filter((url) => new URL(url).protocol === "https:")
    : candidates;
  if (!secureCandidates.length) throw new Error("No secure Hub endpoint is available.");
  return Promise.any(secureCandidates.map(async (url) => {
    const candidate = createApi(url, route.token, false, routeChanges);
    const validated = await validateHubConnection(candidate, expectedUser);
    return { api: candidate, ...validated };
  }));
}

async function discoverPeerEndpoints(
  localHub: ReturnType<typeof useLocalHub>,
  nodeId: string
) {
  const shouldWait = localHub.available && typeof location !== "undefined" && location.protocol === "https:";
  const deadline = Date.now() + (shouldWait ? 20_000 : 0);
  let current = await localHub.refresh().catch(() => localHub.status.value);
  while (
    shouldWait &&
    Date.now() < deadline &&
    !current?.peerEndpoints.some((endpoint) => !endpoint.nodeId || endpoint.nodeId === nodeId)
  ) {
    await delay(500);
    current = await localHub.refresh().catch(() => current);
  }
  return current;
}

function shouldAvoidInsecureAndroidRoute(url: string) {
  return Capacitor.getPlatform() === "android" &&
    useLocalHub().status.value?.allowInsecureLan !== true &&
    typeof location !== "undefined" &&
    location.protocol === "https:" &&
    /^http:\/\//i.test(url);
}

async function validateHubConnection(candidate: AetherApi, expectedUser: AuthUser | null) {
  return withConnectionTimeout(async (signal) => {
    await candidate.health(signal);
    const current = await candidate.session(signal);
    if (expectedUser && authUserIdentity(current.user) !== authUserIdentity(expectedUser)) {
      throw new Error("The Hub returned a different account.");
    }
    const status = await candidate.clusterStatus(signal);
    return { user: current.user, status };
  }, 8_000);
}

function authUserIdentity(value: AuthUser | null | undefined) {
  return String(value?.id || value?.email || value?.username || "");
}

interface PairingCode {
  serverUrl: string;
  id: string;
  secret: string;
  expiresAt?: number;
}

export function parsePairingCode(value: string): PairingCode {
  const raw = value.trim();
  let payload: Record<string, unknown>;
  try {
    if (/^aetherx:\/\/pair/i.test(raw)) {
      const url = new URL(raw);
      payload = Object.fromEntries(url.searchParams.entries());
    } else if (raw.startsWith("{")) {
      payload = JSON.parse(raw) as Record<string, unknown>;
    } else {
      const normalized = raw.replace(/-/g, "+").replace(/_/g, "/");
      payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as Record<string, unknown>;
    }
  } catch {
    throw new Error("连接码无法识别，请回到电脑端重新复制。 ");
  }
  const serverUrlValue = String(payload.serverUrl || payload.server || "").trim().replace(/\/+$/, "");
  const id = String(payload.id || "").trim();
  const secret = String(payload.secret || "");
  if (!/^https?:\/\//i.test(serverUrlValue) || !id || secret.length < 32) {
    throw new Error("连接码缺少服务器地址或一次性凭证。 ");
  }
  return {
    serverUrl: serverUrlValue,
    id,
    secret,
    ...(Number(payload.expiresAt) > Date.now() ? { expiresAt: Number(payload.expiresAt) } : {})
  };
}

function androidDeviceName() {
  return /Android/i.test(navigator.userAgent) ? "Android 手机" : "AetherX 移动端";
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function withConnectionTimeout<T>(task: (signal: AbortSignal) => Promise<T>, timeoutMs = 12_000) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await task(controller.signal);
  } finally {
    window.clearTimeout(timeout);
  }
}
