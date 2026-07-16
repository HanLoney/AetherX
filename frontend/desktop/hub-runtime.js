const path = require("node:path");

const DEFAULT_HUB_PORT = 4318;
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

function isLoopbackHubUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return ["http:", "https:"].includes(url.protocol) && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function probeAetherXHub(baseUrl, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 1200);
  try {
    const response = await fetchImpl(`${String(baseUrl).replace(/\/$/, "")}/health`, {
      signal: controller.signal
    });
    if (!response.ok) return false;
    const payload = await response.json();
    return payload?.data?.service === "aetherx-backend";
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function resolveBackendRoot(electronApp, desktopDir = __dirname) {
  return electronApp.isPackaged
    ? path.join(process.resourcesPath, "backend")
    : path.resolve(desktopDir, "..", "..", "backend");
}

function resolveHubDataDir(electronApp, backendRoot, environment = process.env) {
  return (
    environment.AETHERX_DATA_DIR ||
    environment.XUANAI_DATA_DIR ||
    (electronApp.isPackaged
      ? path.join(electronApp.getPath("userData"), "hub")
      : path.join(backendRoot, ".data"))
  );
}

async function startLocalHub(options) {
  const {
    electronApp,
    baseUrl,
    environment = process.env,
    desktopDir = __dirname,
    fetchImpl = globalThis.fetch
  } = options;
  if (!isLoopbackHubUrl(baseUrl)) return null;
  const backendRoot = resolveBackendRoot(electronApp, desktopDir);
  const configureUsbDevices = () => {
    if (!options.enableAdbReverse) return;
    try {
      const configure =
        options.ensureAdbReverse ||
        require(path.join(backendRoot, "scripts", "ensure-adb-reverse.js"))
          .ensureAdbReverse;
      const url = new URL(baseUrl);
      configure({
        env: {
          ...environment,
          AETHERX_PORT: String(url.port || DEFAULT_HUB_PORT)
        }
      });
    } catch (error) {
      console.warn(`[AetherX] 自动配置手机 USB 连接失败，Hub 仍会正常运行：${error.message}`);
    }
  };
  if (await probeAetherXHub(baseUrl, { fetchImpl })) {
    configureUsbDevices();
    return { owned: false, baseUrl, stop: async () => {} };
  }

  const createBackendApp =
    options.createBackendApp || require(path.join(backendRoot, "src", "app.js")).createApp;
  const url = new URL(baseUrl);
  const hub = createBackendApp({
    host:
      environment.AETHERX_HUB_HOST ||
      (url.hostname === "localhost" ? "127.0.0.1" : url.hostname),
    port: Number(url.port || DEFAULT_HUB_PORT),
    dataDir: resolveHubDataDir(electronApp, backendRoot, environment),
    masterKey: environment.AETHERX_MASTER_KEY || environment.XUANAI_MASTER_KEY || "",
    registrationMode: environment.AETHERX_REGISTRATION_MODE || "open",
    registrationSecret: environment.AETHERX_REGISTRATION_SECRET || "",
    sessionTtlDays: Number(environment.AETHERX_SESSION_TTL_DAYS || 30),
    corsOrigin: environment.AETHERX_CORS_ORIGIN || "*"
  });

  try {
    await hub.listen();
  } catch (error) {
    await safeClose(hub);
    if (error?.code === "EADDRINUSE" && (await probeAetherXHub(baseUrl, { fetchImpl }))) {
      return { owned: false, baseUrl, stop: async () => {} };
    }
    throw error;
  }

  configureUsbDevices();

  return {
    owned: true,
    baseUrl,
    backendRoot,
    dataDir: resolveHubDataDir(electronApp, backendRoot, environment),
    stop: () => safeClose(hub)
  };
}

async function safeClose(hub) {
  try {
    await hub.close();
  } catch (error) {
    if (error?.code !== "ERR_SERVER_NOT_RUNNING") throw error;
  }
}

module.exports = {
  isLoopbackHubUrl,
  probeAetherXHub,
  resolveBackendRoot,
  resolveHubDataDir,
  startLocalHub
};
