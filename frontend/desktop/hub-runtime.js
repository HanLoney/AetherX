const fs = require("node:fs");
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

function resolveEnabledFlag(value, fallback = true) {
  if (value === undefined || value === null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  throw new Error("Hub feature flags must use a boolean value.");
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
      ? path.join(electronApp.getPath("appData"), "AetherX", "hub")
      : path.join(backendRoot, ".data"))
  );
}

async function prepareHubDataDir(electronApp, backendRoot, environment = process.env) {
  const dataDir = resolveHubDataDir(electronApp, backendRoot, environment);
  if (!electronApp.isPackaged || environment.AETHERX_DATA_DIR || environment.XUANAI_DATA_DIR) {
    return dataDir;
  }
  const legacyDir = path.join(electronApp.getPath("userData"), "hub");
  if (samePath(legacyDir, dataDir) || !hasHubDatabase(legacyDir) || hasHubDatabase(dataDir)) {
    return dataDir;
  }
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  if (fs.existsSync(dataDir)) {
    const entries = fs.readdirSync(dataDir);
    if (entries.length) {
      const error = new Error("Canonical and legacy desktop Hub data directories both contain data.");
      error.code = "HUB_DATA_MIGRATION_CONFLICT";
      error.details = { dataDir, legacyDir };
      throw error;
    }
    fs.rmdirSync(dataDir);
  }
  fs.renameSync(legacyDir, dataDir);
  return dataDir;
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
  const dataDir = await prepareHubDataDir(electronApp, backendRoot, environment);
  const control = options.control || require(path.join(
    backendRoot,
    "src",
    "infrastructure",
    "hub-control-channel.js"
  ));
  const controlPipe = environment.AETHERX_HUB_CONTROL_PIPE || control.getHubControlPipe();
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
  let takeover = { status: "not-needed", previousPid: null, previousHost: "" };
  if (await probeAetherXHub(baseUrl, { fetchImpl })) {
    takeover = await takeoverManagedHub({
      baseUrl,
      dataDir,
      control,
      controlPipe,
      fetchImpl,
      timeoutMs: options.takeoverTimeoutMs
    });
    if (takeover.status !== "completed") {
      configureUsbDevices();
      return externalHubHandle({ baseUrl, dataDir, takeover });
    }
  }

  const createBackendApp =
    options.createBackendApp || require(path.join(backendRoot, "src", "app.js")).createApp;
  const url = new URL(baseUrl);
  const hub = createBackendApp({
    host:
      environment.AETHERX_HUB_HOST ||
      "0.0.0.0",
    port: Number(url.port || DEFAULT_HUB_PORT),
    dataDir,
    masterKey: environment.AETHERX_MASTER_KEY || environment.XUANAI_MASTER_KEY || "",
    registrationMode: environment.AETHERX_REGISTRATION_MODE || "open",
    registrationSecret: environment.AETHERX_REGISTRATION_SECRET || "",
    sessionTtlDays: Number(environment.AETHERX_SESSION_TTL_DAYS || 30),
    replicationSchedulerEnabled: resolveEnabledFlag(
      environment.AETHERX_REPLICATION_SCHEDULER_ENABLED
    ),
    switchRecoveryEnabled: resolveEnabledFlag(
      environment.AETHERX_SWITCH_RECOVERY_ENABLED
    ),
    replicationPollIntervalMs: Number(
      environment.AETHERX_REPLICATION_POLL_INTERVAL_MS || 5000
    ),
    replicationMaxBackoffMs: Number(
      environment.AETHERX_REPLICATION_MAX_BACKOFF_MS || 300000
    ),
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

  let controlServer;
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (controlServer) await new Promise((resolve) => controlServer.close(resolve));
    controlServer = null;
    await safeClose(hub);
  };
  try {
    controlServer = await control.createHubControlServer(controlPipe, async (command) => {
      if (command === "status") {
        return {
          component: "hub",
          pid: process.pid,
          healthy: true,
          port: Number(url.port || DEFAULT_HUB_PORT),
          dataDir,
          host: "desktop"
        };
      }
      if (command === "stop") {
        setImmediate(() => {
          if (typeof options.requestQuit === "function") options.requestQuit();
          else stop().catch(() => {});
        });
        return { stopping: true };
      }
      throw new Error("Unsupported Hub control command.");
    });
  } catch (error) {
    await safeClose(hub);
    throw error;
  }

  configureUsbDevices();

  return {
    owned: true,
    runtimeMode: "embedded",
    baseUrl,
    backendRoot,
    dataDir,
    takeover,
    stop,
    status: () => runtimeStatus("embedded", dataDir, takeover)
  };
}

async function takeoverManagedHub(options) {
  let status;
  try {
    status = await options.control.requestHubControl(options.controlPipe, "status", {
      timeoutMs: 1500
    });
  } catch {
    return { status: "unmanaged", previousPid: null, previousHost: "external" };
  }
  if (!status?.ok || status.component !== "hub" || !status.healthy) {
    return { status: "unmanaged", previousPid: null, previousHost: "external" };
  }
  const legacyLauncher = !status.dataDir && !status.host;
  if (!legacyLauncher && (!status.dataDir || !samePath(status.dataDir, options.dataDir))) {
    return {
      status: "data-dir-mismatch",
      previousPid: Number(status.pid) || null,
      previousHost: String(status.host || "external"),
      previousDataDir: String(status.dataDir || "")
    };
  }
  const response = await options.control.requestHubControl(options.controlPipe, "stop", {
    timeoutMs: 2200
  });
  if (!response?.ok || !response.stopping) {
    const error = new Error(response?.error || "The existing Hub refused desktop takeover.");
    error.code = "HUB_TAKEOVER_REFUSED";
    throw error;
  }
  const stopped = await waitForHubState(
    options.baseUrl,
    false,
    options.fetchImpl,
    options.timeoutMs || 12_000
  );
  if (!stopped) {
    const error = new Error("The existing Hub did not stop before desktop takeover timed out.");
    error.code = "HUB_TAKEOVER_TIMEOUT";
    throw error;
  }
  return {
    status: "completed",
    previousPid: Number(status.pid) || null,
    previousHost: String(status.host || (legacyLauncher ? "legacy-launcher" : "external"))
  };
}

async function waitForHubState(baseUrl, expected, fetchImpl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await probeAetherXHub(baseUrl, { fetchImpl, timeoutMs: 500 })) === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return false;
}

function externalHubHandle({ baseUrl, dataDir, takeover }) {
  return {
    owned: false,
    runtimeMode: "external",
    baseUrl,
    dataDir,
    takeover,
    stop: async () => {},
    status: () => runtimeStatus("external", dataDir, takeover)
  };
}

function runtimeStatus(mode, dataDir, takeover) {
  return {
    mode,
    owned: mode === "embedded",
    dataDir,
    takeoverStatus: takeover?.status || "not-needed",
    previousHost: takeover?.previousHost || ""
  };
}

function hasHubDatabase(dataDir) {
  try {
    return fs.statSync(path.join(dataDir, "xuanai.db")).isFile();
  } catch {
    return false;
  }
}

function samePath(left, right) {
  const normalize = (value) => path.resolve(String(value || "")).replace(/[\\/]+$/, "").toLowerCase();
  return normalize(left) === normalize(right);
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
  prepareHubDataDir,
  resolveBackendRoot,
  resolveEnabledFlag,
  resolveHubDataDir,
  startLocalHub,
  takeoverManagedHub
};
