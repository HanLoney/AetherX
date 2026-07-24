import { computed, readonly, ref } from "vue";
import { AetherApi, type AuthConfig, type AuthUser } from "../lib/api";
import { clearSession, loadServerUrl, loadSession, saveServerUrl, saveSession } from "../lib/storage";

const ready = ref(false);
const busy = ref(false);
const user = ref<AuthUser | null>(null);
const serverUrl = ref("");
const error = ref("");
let api: AetherApi | null = null;
let bootstrapPromise: Promise<void> | null = null;

function createApi(url: string, token = "", invalidateOnUnauthorized = true) {
  return new AetherApi({
    baseUrl: url,
    token,
    ...(invalidateOnUnauthorized ? { onUnauthorized: () => void invalidate() } : {})
  });
}

async function bootstrap() {
  if (ready.value) return;
  if (bootstrapPromise) return bootstrapPromise;
  bootstrapPromise = (async () => {
    serverUrl.value = await loadServerUrl();
    const stored = await loadSession();
    if (stored?.token) {
      api = createApi(serverUrl.value, stored.token);
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
    const current = await candidate.session();
    if (api !== candidate) return;
    user.value = current.user;
    await saveSession({ token: stored.token, user: current.user });
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
  serverUrl.value = candidate.serverUrl;
  await Promise.all([
    saveServerUrl(serverUrl.value),
    saveSession({ token, user: authenticatedUser })
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
  const token = api.accessToken;
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
    if (current.user.id !== previousUser.id) {
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

async function logout() {
  try { await api?.logout(); } catch { /* 本地退出不依赖网络 */ }
  await invalidate();
}

async function invalidate() {
  user.value = null;
  if (serverUrl.value) api = createApi(serverUrl.value);
  await clearSession();
  window.dispatchEvent(new CustomEvent("aetherx:session-invalidated"));
  if (window.location.hash !== "#/login") window.location.hash = "#/login";
}

function requireApi() {
  if (!api || !user.value) throw new Error("登录状态已失效，请重新登录。 ");
  return api;
}

export function useSessionStore() {
  return {
    ready: readonly(ready),
    busy: readonly(busy),
    user: readonly(user),
    serverUrl: readonly(serverUrl),
    error: readonly(error),
    authenticated: computed(() => Boolean(user.value)),
    bootstrap,
    login,
    register,
    inspectRegistration,
    pair,
    reconnect,
    refreshCurrentUser,
    logout,
    requireApi
  };
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
