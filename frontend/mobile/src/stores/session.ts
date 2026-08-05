import { computed, readonly, ref } from "vue";
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

function createApi(url: string, token = "", invalidateOnUnauthorized = true) {
  let instance: AetherApi;
  instance = new AetherApi({
    baseUrl: url,
    token,
    ...(invalidateOnUnauthorized ? { onUnauthorized: () => void invalidate() } : {}),
    onConnectionChanged: (connection) => applyRoutedConnection(instance, connection)
  });
  return instance;
}

async function bootstrap() {
  if (ready.value) return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    routing.value = await loadHubRouting();
    serverUrl.value = await loadServerUrl();
    const stored = await loadSession();
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
      void validateStoredSession(api, stored);
    } else {
      api = createApi(serverUrl.value);
    }
    ready.value = true;
  })().finally(() => { bootstrapPromise = null; });
  return bootstrapPromise;
}

async function validateStoredSession(candidate: AetherApi, stored: { token: string; user: AuthUser }) {
  try {
    const status = await candidate.ensureActiveHub();
    await rememberCluster(candidate, status);
    const current = await candidate.session();
    if (api !== candidate) return;
    user.value = current.user;
    await saveSession({ token: candidate.accessToken || stored.token, user: current.user });
  } catch {
    // 网络中断时继续使用本地缓存；真正的 401 会由 API 统一触发退出。
  }
}

async function login(input: { serverUrl: string; username: string; password: string }) {
  busy.value = true;
  error.value = "";
  try {
    const candidate = createApi(input.serverUrl);
    await candidate.health();
    const result = await candidate.login({ username: input.username, password: input.password });
    await establishAuthenticatedSession(candidate, result.token, result.user);
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
  username: string;
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
      username: input.username,
      displayName: input.displayName,
      password: input.password,
      registrationSecret: input.registrationSecret
    });
    await establishAuthenticatedSession(candidate, result.token, result.user);
    return result;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "账号没有创建成功。";
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

async function establishAuthenticatedSession(candidate: AetherApi, token: string, authenticatedUser: AuthUser) {
  api = createApi(candidate.serverUrl, token);
  user.value = authenticatedUser;
  serverUrl.value = api.serverUrl;
  await Promise.all([
    saveServerUrl(serverUrl.value),
    saveSession({ token, user: authenticatedUser })
  ]);
  const status = await api.ensureActiveHub();
  await rememberCluster(api, status);
  const current = await api.session();
  user.value = current.user;
  serverUrl.value = api.serverUrl;
  await Promise.all([
    saveServerUrl(serverUrl.value),
    saveSession({ token: api.accessToken, user: current.user })
  ]);
}

async function pair(code: string) {
  busy.value = true;
  error.value = "";
  try {
    const payload = parsePairingCode(code);
    const candidate = createApi(payload.serverUrl, "", false);
    await candidate.health();
    await candidate.claimPairingSession(payload.id, {
      secret: payload.secret,
      deviceName: androidDeviceName()
    });
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
    if (current.user.username !== previousUser.username) {
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
  await saveSession({ token: api.accessToken, user: current.user });
  return current.user;
}

async function activateLocalHub() {
  const currentUser = user.value;
  if (!currentUser) throw new Error("登录状态已失效，请重新登录。 ");
  busy.value = true;
  error.value = "";
  try {
    const localHub = useLocalHub();
    await localHub.switchToLocal();
    const local = localHub.status.value;
    if (!local || local.role !== "active" || local.state !== "stable") {
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
    const switched = await localHub.switchToPeer();
    const route = routing.value?.nodes.find((node) => node.nodeId === switched.activeNodeId);
    if (!route?.serverUrl || !route.token) {
      throw new Error("电脑 Hub 已接管，但手机缺少可用的登录凭证，请重新配对连接。 ");
    }
    const candidate = createApi(route.serverUrl, route.token, false);
    const current = await withConnectionTimeout(async (signal) => {
      await candidate.health(signal);
      return candidate.session(signal);
    });
    if (current.user.username !== currentUser.username) {
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

function createDesktopControlConnection() {
  const currentLocalNodeId = useLocalHub().status.value?.localNodeId || localNodeId.value;
  const route = [...(routing.value?.nodes || [])]
    .filter((node) =>
      node.nodeId !== currentLocalNodeId &&
      /^https?:\/\//i.test(node.serverUrl) &&
      Boolean(node.token)
    )
    .sort((left, right) => right.lastSeenAt - left.lastSeenAt)[0];
  if (!route) return null;
  return {
    nodeId: route.nodeId,
    api: new AetherApi({ baseUrl: route.serverUrl, token: route.token })
  };
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
    inspectRegistration,
    pair,
    reconnect,
    activateLocalHub,
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
