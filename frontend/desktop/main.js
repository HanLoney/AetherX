const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  Notification,
  safeStorage,
  Tray,
  dialog,
  clipboard
} = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { XuanApiClient } = require("./api-client");
const {
  AuthStore,
  isDirectMobileHubUrl,
  selectAuthenticationSession,
  shouldKeepRoutedConnection
} = require("./auth-store");
const { startLocalHub } = require("./hub-runtime");
const {
  DesktopControlCoordinator,
  DesktopSyncCoordinator
} = require("./sync-runtime");
const { generatePairingQrDataUrl } = require("./qr-code");
const { createDesktopControlServer } = require("./desktop-control");
const { discoverHubPairingEndpoints } = require("./pairing-endpoints");
const { loadMobileHubStatus } = require("./mobile-hub-status");
const {
  MobileHubLanDiscovery,
  verifyMobileHubEndpoint
} = require("./mobile-hub-lan-discovery");
const { inspectWindowsNetworkProfiles } = require("./windows-network-profile");

const appIcon = path.join(__dirname, "app-icon-rounded.png");
const localHubServerUrl = "http://127.0.0.1:4318";
const defaultServerUrl =
  process.env.AETHERX_SERVER_URL ||
  process.env.XUANAI_SERVER_URL ||
  localHubServerUrl;
let authStore;
let mainWindow;
let currentUser = null;
let hubRouting = null;
let localHub = null;
let tray = null;
let isQuitting = false;
let hubShutdownComplete = false;
let hubShutdownPromise = null;
let desktopControlServer = null;
let authenticationServerUrl = defaultServerUrl;
let authenticationToken = "";
let latestClusterStatus = null;
let clusterRecoveryPromise = null;
let tailscaleManager = null;
const mobileHubLanDiscovery = new MobileHubLanDiscovery();
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const api = new XuanApiClient({
  baseUrl: defaultServerUrl,
  onConnectionChanged: handleHubConnectionChanged,
  onUnauthorized: () => {
    if (!api.token || !authStore) return;
    if (api.baseUrl !== authenticationServerUrl && authenticationToken) {
      api.setBaseUrl(authenticationServerUrl);
      api.setToken(authenticationToken);
      saveAuthenticatedState();
      return;
    }
    api.setToken("");
    authenticationToken = "";
    currentUser = null;
    hubRouting = null;
    desktopSync.stop();
    desktopControl.stop();
    latestClusterStatus = null;
    api.setBaseUrl(authenticationServerUrl || localHubServerUrl);
    authStore.clearSession(api.baseUrl);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile("auth.html");
  }
});

function currentHubEndpoints() {
  return discoverHubPairingEndpoints({ serverUrl: api.baseUrl });
}
const desktopSync = new DesktopSyncCoordinator({
  api,
  onChanges: async (changes) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (changes.some((change) => change.entityType === "archive_restore" && change.operation === "reset")) {
      const session = await api.getSession();
      currentUser = session.user;
      saveAuthenticatedState();
      mainWindow.webContents.reload();
      return;
    }
    mainWindow.webContents.send("sync:received", changes);
  }
});
const desktopControl = new DesktopControlCoordinator({
  onEvent: handleDesktopControlEvent
});

function startAuthenticatedControl() {
  if (!currentUser || !authenticationToken) {
    desktopControl.stop();
    return;
  }
  desktopControl.start({
    baseUrl: authenticationServerUrl,
    token: authenticationToken,
    clientId: `desktop:${currentUser.id || currentUser.username}`
  });
}

async function startAuthenticatedSync() {
  if (!currentUser || !api.token) return;
  startAuthenticatedControl();
  const scope = hubRouting?.spaceId || api.baseUrl;
  await desktopSync.start(`${scope}|${currentUser.username}`);
}

function saveAuthenticatedState() {
  authStore?.save({
    serverUrl: authenticationServerUrl,
    token: authenticationToken,
    user: currentUser,
    routing: hubRouting
  });
}

function upsertRoutingNode(routing, node) {
  const nodes = Array.isArray(routing?.nodes) ? [...routing.nodes] : [];
  const next = {
    nodeId: String(node.nodeId || ""),
    serverUrl: String(node.serverUrl || ""),
    token: String(node.token || ""),
    lastSeenAt: Date.now()
  };
  const index = nodes.findIndex((item) => item.nodeId === next.nodeId);
  if (index >= 0) nodes[index] = next;
  else nodes.push(next);
  return nodes;
}

function applyClusterStatus(status) {
  if (!status?.spaceId || !status.localNodeId) return;
  if (
    hubRouting?.spaceId === status.spaceId &&
    Number(status.epoch) < Number(hubRouting.epoch)
  ) return;
  latestClusterStatus = status;
  hubRouting = {
    spaceId: status.spaceId,
    activeNodeId: status.activeNodeId,
    localNodeId: status.localNodeId,
    epoch: Number(status.epoch) || 1,
    nodes: upsertRoutingNode(hubRouting, {
      nodeId: status.localNodeId,
      serverUrl: api.baseUrl,
      token: api.token
    })
  };
}

function sendHubClusterChanged(status) {
  if (!status || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send("hub:cluster-changed", withDesktopRuntime(status));
}

function withDesktopRuntime(status) {
  return status ? { ...status, desktopRuntime: localHub?.status?.() || null } : status;
}

function getTailscaleManager() {
  if (tailscaleManager) return tailscaleManager;
  const modulePath = app.isPackaged
    ? path.join(process.resourcesPath, "connection-runtime", "tailscale-manager.js")
    : path.resolve(__dirname, "..", "launcher", "tailscale-manager.js");
  const { TailscaleManager } = require(modulePath);
  tailscaleManager = new TailscaleManager();
  return tailscaleManager;
}

async function probeLocalHub() {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1500);
  try {
    const response = await fetch(`${localHubServerUrl}/health`, { signal: controller.signal });
    if (!response.ok) return { online: false, latencyMs: Date.now() - startedAt, mobile: null };
    const payload = await response.json();
    return {
      online: payload?.data?.service === "aetherx-backend",
      latencyMs: Date.now() - startedAt,
      mobile: payload?.data?.mobile || null
    };
  } catch {
    return { online: false, latencyMs: null, mobile: null };
  } finally {
    clearTimeout(timer);
  }
}

async function loadConnectionStatus() {
  const authenticated = Boolean(currentUser && api.token);
  const localApi = authenticated ? authenticatedLocalHubApi() : null;
  const [hubHealth, cluster, localCluster, mobileDetail, devices, endpoints, lanAccess] = await Promise.all([
    probeLocalHub(),
    authenticated ? settleStatus(api.getClusterStatus(), latestClusterStatus) : null,
    localApi ? settleStatus(localApi.getClusterStatus(), null) : null,
    localApi ? settleStatus(localApi.listMobileHubs(), { hubs: [] }) : { hubs: [] },
    authenticated ? settleStatus(api.listDevices(), []) : [],
    settleStatus(discoverHubPairingEndpoints({ serverUrl: localHubServerUrl }), []),
    settleStatus(inspectWindowsNetworkProfiles(), {
      status: "unavailable", private: false, public: false, profiles: []
    })
  ]);
  const network = await settleStatus(
    getTailscaleManager().getStatus({ hubHealthy: hubHealth.online }),
    {
      tailscale: { installed: false, connected: false, state: "unavailable", peers: [] },
      remote: { enabled: false, healthy: false, status: "unavailable", url: "" }
    }
  );
  const activeNode = cluster?.nodes?.find((node) => node.id === cluster.activeNodeId) || null;
  const localNode = localCluster?.nodes?.find((node) => node.id === localCluster.localNodeId) || null;
  const deviceList = Array.isArray(devices) ? devices : devices?.devices || [];
  return {
    authenticated,
    desktop: {
      running: true,
      pid: process.pid,
      version: app.getVersion(),
      routedServerUrl: api.baseUrl,
      connected: Boolean(cluster)
    },
    computerHub: {
      online: hubHealth.online,
      latencyMs: hubHealth.latencyMs,
      runtime: localHub?.status?.() || null,
      node: localNode,
      active: Boolean(localCluster && localCluster.activeNodeId === localCluster.localNodeId),
      cluster: localCluster,
      mobileSummary: hubHealth.mobile
    },
    activeHub: activeNode,
    cluster,
    mobileHubs: Array.isArray(mobileDetail?.hubs) ? mobileDetail.hubs : [],
    devices: deviceList,
    network: {
      ...network,
      lanAccess,
      endpoints: Array.isArray(endpoints) ? endpoints : []
    }
  };
}

async function settleStatus(promise, fallback) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

async function handleDesktopControlEvent(message) {
  if (message?.event === "ready") return recoverHubRoutingAfterControlEvent();
  if (message?.event !== "cluster-change") return;
  const cluster = message.data?.cluster;
  if (!cluster?.spaceId) return;
  latestClusterStatus = cluster;
  sendHubClusterChanged(cluster);
  if (cluster.state !== "stable") return;
  return recoverHubRoutingAfterControlEvent();
}

function recoverHubRoutingAfterControlEvent() {
  if (clusterRecoveryPromise) return clusterRecoveryPromise;
  clusterRecoveryPromise = recoverHubRoutingFromAuthority()
    .catch((error) => {
      console.warn("Unable to refresh desktop Hub routing.", error?.message || error);
    })
    .finally(() => {
      clusterRecoveryPromise = null;
    });
  return clusterRecoveryPromise;
}

async function recoverHubRoutingFromAuthority() {
  if (!currentUser || !authenticationToken) return null;
  const previousBaseUrl = api.baseUrl;
  const previousToken = api.token;
  const previousRouting = hubRouting
    ? { ...hubRouting, nodes: Array.isArray(hubRouting.nodes) ? [...hubRouting.nodes] : [] }
    : null;
  try {
    api.setBaseUrl(authenticationServerUrl);
    api.setToken(authenticationToken);
    const status = await ensureActiveHubWithDiscovery();
    desktopSync.stop();
    await startAuthenticatedSync();
    sendHubClusterChanged(status);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("hub:routed", {
        serverUrl: api.baseUrl,
        nodeId: status.localNodeId,
        activeNodeId: status.activeNodeId,
        epoch: status.epoch
      });
    }
    return status;
  } catch (error) {
    if (shouldKeepRoutedConnection(hubRouting, previousRouting)) {
      saveAuthenticatedState();
      setTimeout(() => void recoverHubRoutingAfterControlEvent(), 3_000);
    } else {
      api.setBaseUrl(previousBaseUrl);
      api.setToken(previousToken);
      hubRouting = previousRouting;
      saveAuthenticatedState();
    }
    throw error;
  }
}

async function ensureActiveHub() {
  if (!api.token || !currentUser) return null;
  const status = await api.ensureActiveHub();
  applyClusterStatus(status);
  saveAuthenticatedState();
  return status;
}

async function ensureActiveHubWithDiscovery(onProgress = () => {}) {
  if (!api.token || !currentUser) return null;
  onProgress({ stage: "checking", message: "正在读取双 Hub 状态…" });
  try {
    const status = await api.getClusterStatus();
    applyClusterStatus(status);
    let verifiedEndpoint = "";
    const mobileIsActive = status.localNodeId !== status.activeNodeId;
    if (status.localNodeId !== status.activeNodeId) {
      onProgress({
        stage: "searching",
        target: "mobile",
        message: "手机 Hub 当前为活动中枢，正在局域网中搜索…"
      });
      const candidates = await mobileHubLanDiscovery.discoverCandidates();
      if (!candidates.length) {
        onProgress({
          stage: "not-found",
          target: "mobile",
          message: "暂未发现新的手机地址，正在尝试已登记连接…"
        });
      }
      for (const endpoint of candidates) {
        onProgress({
          stage: "verifying",
          target: "mobile",
          endpoint: endpoint.address,
          message: "已发现手机 Hub，正在安全验证身份…"
        });
        try {
          await api.discoverMobileHubEndpoint(status.activeNodeId, endpoint);
          verifiedEndpoint = endpoint.address;
          onProgress({
            stage: "verified",
            target: "mobile",
            endpoint: verifiedEndpoint,
            message: "手机 Hub 身份验证通过，正在切换会话…"
          });
          break;
        } catch {
          // Broadcasts are untrusted candidates; the Hub accepts only a valid Peer handshake.
        }
      }
    }
    onProgress({
      stage: "routing",
      target: status.localNodeId === status.activeNodeId ? "computer" : "mobile",
      endpoint: verifiedEndpoint,
      message: status.localNodeId === status.activeNodeId
        ? "电脑 Hub 当前为活动中枢，正在进入…"
        : "正在连接活动手机 Hub…"
    });
    let activeStatus;
    try {
      activeStatus = await ensureActiveHub();
    } catch (error) {
      const mobilePending = mobileIsActive && !verifiedEndpoint && [
        "PEER_ENDPOINT_UNAVAILABLE",
        "PEER_DISCOVERY_FAILED",
        "HUB_NOT_ACTIVE"
      ].includes(error?.code);
      if (!mobilePending) throw error;
      onProgress({
        stage: "connected",
        target: "computer",
        pendingTarget: "mobile",
        message: "电脑 Hub 已连接，手机 Hub 暂未在线，稍后会自动重连。"
      });
      return status;
    }
    const target = activeStatus.localNodeId === status.localNodeId ? "computer" : "mobile";
    onProgress({
      stage: "connected",
      target,
      endpoint: api.baseUrl,
      message: target === "mobile" ? "已安全连接手机 Hub" : "已连接电脑 Hub"
    });
    return activeStatus;
  } catch (error) {
    onProgress({
      stage: "failed",
      target: "mobile",
      message: friendlyHubConnectionError(error)
    });
    throw error;
  }
}

function friendlyHubConnectionError(error) {
  if (["PEER_ENDPOINT_UNAVAILABLE", "PEER_DISCOVERY_FAILED"].includes(error?.code)) {
    return "手机 Hub 暂时无法连接，请确认手机端已打开并与电脑处于同一网络。";
  }
  return String(error?.message || "Hub 连接失败，请稍后重试。");
}

function sendAuthHubProgress(sender, progress) {
  if (!sender || sender.isDestroyed()) return;
  sender.send("auth:hub-progress", { ...progress, updatedAt: Date.now() });
}

async function authHubDiscoveryStatus(waitForMobile = false) {
  const computer = await probeLocalHub();
  const candidates = waitForMobile
    ? await mobileHubLanDiscovery.discoverCandidates(1_200)
    : mobileHubLanDiscovery.candidates();
  const mobile = candidates[0] || null;
  const verifiedMobile = mobile
    ? await verifyMobileHubEndpoint(fetch, mobile.address, { timeoutMs: 1_200 })
    : null;
  return {
    computerHub: {
      state: computer.online ? "ready" : "offline",
      endpoint: localHubServerUrl,
      latencyMs: computer.latencyMs
    },
    mobileHub: {
      state: verifiedMobile ? "online" : mobile ? "discovered" : waitForMobile ? "notFound" : "searching",
      endpoint: mobile?.address || "",
      candidateCount: candidates.length,
      latencyMs: verifiedMobile?.latencyMs ?? null
    },
    activeTarget: latestClusterStatus
      ? latestClusterStatus.activeNodeId === latestClusterStatus.localNodeId ? "computer" : "mobile"
      : "unknown"
  };
}

async function localDesktopLoginRequest(pathname, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${localHubServerUrl}${pathname}`, {
      ...options,
      headers: { "Content-Type": "application/json", ...(options.headers || {}) },
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload?.error?.message || "电脑扫码登录请求失败。");
      error.code = payload?.error?.code || "DESKTOP_QR_LOGIN_FAILED";
      throw error;
    }
    return payload.data;
  } finally {
    clearTimeout(timer);
  }
}

async function createDesktopQrLogin() {
  const challenge = await localDesktopLoginRequest(
    "/api/v1/auth/desktop-login/challenges",
    { method: "POST", body: "{}" }
  );
  const discovered = await discoverHubPairingEndpoints({ serverUrl: localHubServerUrl });
  const lanEndpoint = discovered.find((item) => item.transport === "lan");
  const fallbackEndpoint = discovered.find((item) => item !== lanEndpoint);
  const endpoints = [lanEndpoint, fallbackEndpoint]
    .filter(Boolean)
    .map((item) => String(item.address || "").replace(/\/+$/, ""))
    .filter(Boolean);
  if (!endpoints.length) {
    throw new Error("电脑当前没有可供手机访问的网络地址，请先连接同一局域网。");
  }
  const code = new URL("aetherx://desktop-login");
  code.searchParams.set("v", "1");
  code.searchParams.set("id", challenge.id);
  code.searchParams.set("secret", challenge.secret);
  code.searchParams.set("expiresAt", String(challenge.expiresAt));
  for (const endpoint of endpoints) code.searchParams.append("e", endpoint);
  return {
    id: challenge.id,
    secret: challenge.secret,
    expiresAt: challenge.expiresAt,
    endpoints,
    qrDataUrl: await generatePairingQrDataUrl(code.toString())
  };
}

async function completeDesktopQrLogin(sender, input = {}) {
  const id = encodeURIComponent(String(input.id || ""));
  const secret = encodeURIComponent(String(input.secret || ""));
  const result = await localDesktopLoginRequest(
    `/api/v1/auth/desktop-login/challenges/${id}?secret=${secret}`,
    { method: "GET" }
  );
  if (result.status !== "authorized") return result;
  api.setBaseUrl(localHubServerUrl);
  api.setToken(result.token);
  authenticationServerUrl = localHubServerUrl;
  authenticationToken = result.token;
  currentUser = result.user;
  hubRouting = null;
  await ensureActiveHubWithDiscovery((progress) => sendAuthHubProgress(sender, progress));
  saveAuthenticatedState();
  await startAuthenticatedSync();
  openPage(sender, "home.html");
  return { status: "completed", user: currentUser };
}

async function handleHubConnectionChanged(connection) {
  currentUser = connection.user;
  const nextRouting = {
    spaceId: connection.spaceId,
    activeNodeId: connection.activeNodeId,
    localNodeId: connection.nodeId,
    epoch: Number(connection.epoch) || 1,
    nodes: upsertRoutingNode(hubRouting, {
      nodeId: connection.nodeId,
      serverUrl: connection.baseUrl,
      token: connection.token
    })
  };
  if (!shouldKeepRoutedConnection(nextRouting, hubRouting)) {
    throw new Error("活动 Hub 返回了过期的路由代次。");
  }
  hubRouting = nextRouting;
  saveAuthenticatedState();
  await startAuthenticatedSync();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("hub:routed", {
      serverUrl: connection.baseUrl,
      nodeId: connection.nodeId,
      activeNodeId: connection.activeNodeId,
      epoch: connection.epoch
    });
  }
}

function registerIpcHandlers() {
  ipcMain.on("window:minimize", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.on("window:maximize", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("window:close", (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
  ipcMain.handle("notification:show", (event, input = {}) => {
    if (!Notification.isSupported()) return false;
    const win = BrowserWindow.fromWebContents(event.sender);
    const notification = new Notification({
      title: String(input.title || "AetherX"),
      body: String(input.body || ""),
      icon: appIcon
    });
    notification.on("click", () => {
      if (!win || win.isDestroyed()) return;
      win.show();
      win.focus();
    });
    notification.show();
    return true;
  });

  ipcMain.handle("auth:state", () => ({
    serverUrl: authenticationServerUrl,
    hasSession: Boolean(authenticationToken),
    user: currentUser
  }));
  ipcMain.handle("auth:hub-discovery", (_event, options = {}) =>
    authHubDiscoveryStatus(options.wait === true)
  );
  ipcMain.handle("auth:qr-login:create", () => createDesktopQrLogin());
  ipcMain.handle("auth:qr-login:poll", (event, input) =>
    completeDesktopQrLogin(event.sender, input)
  );
  ipcMain.handle("auth:bootstrap", async (event) => {
    if (!api.token) return { authenticated: false };
    const session = await api.getSession();
    currentUser = session.user;
    await ensureActiveHubWithDiscovery((progress) =>
      sendAuthHubProgress(event.sender, progress)
    );
    saveAuthenticatedState();
    await startAuthenticatedSync();
    openPage(event.sender, "home.html");
    return { authenticated: true, user: currentUser };
  });
  ipcMain.handle("auth:config", async (_event, serverUrl) => {
    const nextServerUrl = isDirectMobileHubUrl(serverUrl)
      ? localHubServerUrl
      : serverUrl;
    const previousServerUrl = authenticationServerUrl;
    api.setBaseUrl(nextServerUrl);
    authenticationServerUrl = api.baseUrl;
    if (authenticationServerUrl !== previousServerUrl) {
      desktopSync.stop();
      desktopControl.stop();
      api.setToken("");
      authenticationToken = "";
      currentUser = null;
      hubRouting = null;
      latestClusterStatus = null;
      authStore.clearSession(api.baseUrl);
    }
    return {
      ...await api.getAuthConfig(),
      serverUrl: authenticationServerUrl
    };
  });
  ipcMain.handle("auth:login", async (event, input) => {
    api.setBaseUrl(isDirectMobileHubUrl(input.serverUrl) ? localHubServerUrl : input.serverUrl);
    authenticationServerUrl = api.baseUrl;
    api.setToken("");
    const result = await api.login({
      username: input.username,
      password: input.password
    });
    api.setToken(result.token);
    authenticationToken = result.token;
    currentUser = result.user;
    await ensureActiveHubWithDiscovery((progress) =>
      sendAuthHubProgress(event.sender, progress)
    );
    saveAuthenticatedState();
    await startAuthenticatedSync();
    openPage(event.sender, "home.html");
    return { user: result.user };
  });
  ipcMain.handle("auth:register", async (event, input) => {
    api.setBaseUrl(isDirectMobileHubUrl(input.serverUrl) ? localHubServerUrl : input.serverUrl);
    authenticationServerUrl = api.baseUrl;
    api.setToken("");
    const result = await api.register({
      username: input.username,
      displayName: input.displayName,
      password: input.password,
      registrationSecret: input.registrationSecret
    });
    api.setToken(result.token);
    authenticationToken = result.token;
    currentUser = result.user;
    await ensureActiveHubWithDiscovery((progress) =>
      sendAuthHubProgress(event.sender, progress)
    );
    saveAuthenticatedState();
    await startAuthenticatedSync();
    openPage(event.sender, "home.html");
    return {
      user: result.user,
      migratedExistingData: result.migratedExistingData
    };
  });
  ipcMain.handle("auth:current", () => ({
    user: currentUser,
    serverUrl: api.baseUrl
  }));
  ipcMain.handle("hub:status", async () => {
    if (!currentUser || !api.token) return null;
    try {
      let status = await api.getClusterStatus();
      if (api.baseUrl !== localHubServerUrl) {
        try {
          const localStatus = await authenticatedLocalHubApi().getClusterStatus();
          if (
            localStatus?.spaceId === status.spaceId &&
            Number(localStatus.forcedTakeover?.divergentOperationCount) > 0
          ) {
            status = { ...status, forcedTakeover: localStatus.forcedTakeover };
          }
        } catch {}
      }
      applyClusterStatus(status);
      return withDesktopRuntime(status);
    } catch (error) {
      if (latestClusterStatus) return withDesktopRuntime(latestClusterStatus);
      throw error;
    }
  });
  ipcMain.handle("connections:status", () => loadConnectionStatus());
  ipcMain.handle("hub:divergence", () =>
    authenticatedLocalHubApi().getHubDivergence(500, 0)
  );
  ipcMain.handle("hub:divergence:recover", (_event, authority) =>
    authenticatedLocalHubApi().recoverHubDivergence(authority)
  );
  ipcMain.handle("hub:divergence:export", async (event) => {
    const evidence = await authenticatedLocalHubApi().exportHubDivergenceEvidence();
    const win = BrowserWindow.fromWebContents(event.sender);
    const takeoverId = String(evidence?.takeover?.id || "evidence")
      .replace(/[^A-Za-z0-9_-]+/g, "-")
      .slice(0, 80);
    const selected = await dialog.showSaveDialog(win, {
      title: "导出 Hub 分叉证据",
      defaultPath: path.join(
        app.getPath("downloads"),
        `AetherX-Hub-分叉证据-${takeoverId}.json`
      ),
      filters: [{ name: "JSON 证据包", extensions: ["json"] }]
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    await fs.promises.writeFile(
      selected.filePath,
      `${JSON.stringify(evidence, null, 2)}\n`,
      "utf8"
    );
    return {
      canceled: false,
      filePath: selected.filePath,
      evidenceHash: evidence.evidenceHash,
      operationCount: evidence.divergentOperations.length
    };
  });
  ipcMain.handle("auth:logout", async (event) => {
    try {
      if (api.token) await api.logout();
    } finally {
      desktopSync.stop();
      desktopControl.stop();
      api.setToken("");
      authenticationToken = "";
      currentUser = null;
      hubRouting = null;
      latestClusterStatus = null;
      api.setBaseUrl(authenticationServerUrl || localHubServerUrl);
      authStore.clearSession(api.baseUrl);
      openPage(event.sender, "auth.html");
    }
    return true;
  });
  ipcMain.handle("devices:pairing:create", (_event, input) =>
    api.createPairingSession(input)
  );
  ipcMain.handle("devices:pairing:get", (_event, id) =>
    api.getPairingSession(id)
  );
  ipcMain.handle("devices:pairing:approve", (_event, id) =>
    api.approvePairingSession(id)
  );
  ipcMain.handle("hubs:pairing:create", (_event, input) =>
    api.createHubPairingSession(input)
  );
  ipcMain.handle("hubs:pairing:endpoints", () =>
    discoverHubPairingEndpoints({ serverUrl: api.baseUrl })
  );
  ipcMain.handle("hubs:pairing:get", (_event, id) =>
    api.getHubPairingSession(id)
  );
  ipcMain.handle("hubs:pairing:approve", (_event, id) =>
    api.approveHubPairingSession(id)
  );
  ipcMain.handle("devices:list", () => api.listDevices());
  ipcMain.handle("devices:revoke", (_event, id) => api.revokeDevice(id));
  ipcMain.handle("devices:delete-record", (_event, id) => api.deleteDeviceRecord(id));
  ipcMain.handle("clipboard:write", (_event, value) => {
    clipboard.writeText(String(value || ""));
    return true;
  });
  ipcMain.handle("qrcode:generate", async (_event, value) => {
    return generatePairingQrDataUrl(value);
  });
  ipcMain.handle("sync:changes", (_event, filters) =>
    api.listSyncChanges(filters)
  );
  ipcMain.handle("archive:export", async (event, input = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const selected = await dialog.showSaveDialog(win, {
      title: "导出 AetherX 完整存档",
      defaultPath: path.join(app.getPath("downloads"), "AetherX-完整存档.aetherx"),
      filters: [{ name: "AetherX 完整存档", extensions: ["aetherx"] }]
    });
    if (selected.canceled || !selected.filePath) return { canceled: true };
    const exported = await api.createArchiveExport(String(input.password || ""));
    const response = await fetch(api.archiveDownloadUrl(exported.downloadPath));
    if (!response.ok || !response.body) throw new Error("存档下载失败，请重新导出。");
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(selected.filePath, { flags: "w" }));
    return { canceled: false, filePath: selected.filePath, summary: exported.summary };
  });
  ipcMain.handle("archive:restore", async (event, input = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const selected = await dialog.showOpenDialog(win, {
      title: "选择 AetherX 完整存档",
      properties: ["openFile"],
      filters: [{ name: "AetherX 完整存档", extensions: ["aetherx"] }]
    });
    if (selected.canceled || !selected.filePaths[0]) return { canceled: true };
    const confirmation = await dialog.showMessageBox(win, {
      type: "warning",
      title: "确认完整恢复",
      message: "这会整套替换当前账号的 AI 数据",
      detail: "聊天、记忆、成长、手记、相册、设置和媒体都会恢复为存档内容。登录密码、当前登录状态和已配对设备会保留；Hub 会先自动备份现有数据。",
      buttons: ["取消", "完整恢复"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });
    if (confirmation.response !== 1) return { canceled: true };
    const result = await api.restoreArchive(
      Readable.toWeb(fs.createReadStream(selected.filePaths[0])),
      String(input.password || "")
    );
    const session = await api.getSession();
    currentUser = session.user;
    await ensureActiveHub();
    saveAuthenticatedState();
    desktopSync.stop();
    await startAuthenticatedSync();
    openPage(event.sender, "home.html");
    return { canceled: false, ...result };
  });

  ipcMain.handle("ai:config:get", () => api.getAiConfig());
  ipcMain.handle("ai:config:save", (_event, input) =>
    api.saveAiConfig(input)
  );
  ipcMain.handle("ai:chat", (_event, payload) => api.requestAi(payload));
  ipcMain.handle("agent:chat", (_event, payload) => api.agentChat(payload));
  ipcMain.handle("agent:approve", (_event, id, approved) =>
    api.approveAgentRun(id, approved)
  );
  ipcMain.handle("agent:permissions:get", () => api.getAgentPermissions());
  ipcMain.handle("agent:permissions:update", (_event, input) =>
    api.updateAgentPermissions(input)
  );
  ipcMain.handle("modules:list", () => api.listModules());
  ipcMain.handle("modules:update", (_event, id, enabled) =>
    api.updateModule(id, enabled)
  );
  ipcMain.handle("modules:activity:list", (_event, filters) =>
    api.listModuleActivity(filters)
  );
  ipcMain.handle("modules:activity:record", (_event, input) =>
    api.recordModuleActivity(input)
  );
  ipcMain.handle("ai:image-config:get", () => api.getAiImageConfig());
  ipcMain.handle("ai:image-config:save", (_event, input) =>
    api.saveAiImageConfig(input)
  );
  ipcMain.handle("ai:image-generate", (_event, payload) =>
    api.generateImage(payload)
  );

  ipcMain.handle("todos:list", (_event, filters) => api.listTodos(filters));
  ipcMain.handle("todos:get", (_event, id) => api.getTodo(id));
  ipcMain.handle("todos:create", (_event, todo) => api.createTodo(todo));
  ipcMain.handle("todos:update", (_event, id, changes) =>
    api.updateTodo(id, changes)
  );
  ipcMain.handle("todos:delete", (_event, id) => api.deleteTodo(id));
  ipcMain.handle("todos:clear-completed", () => api.clearCompletedTodos());

  ipcMain.handle("wallet:summary", () => api.getWalletSummary());
  ipcMain.handle("wallet:transactions", (_event, id, filters) =>
    api.listWalletTransactions(id, filters)
  );
  ipcMain.handle("wallet:transaction-update", (_event, accountId, transactionId, changes) =>
    api.updateWalletTransaction(accountId, transactionId, changes)
  );
  ipcMain.handle("wallet:create", (_event, input) =>
    api.createWalletAccount(input)
  );
  ipcMain.handle("wallet:update", (_event, id, changes) =>
    api.updateWalletAccount(id, changes)
  );
  ipcMain.handle("wallet:adjust", (_event, id, input) =>
    api.adjustWalletAccount(id, input)
  );
  ipcMain.handle("wallet:delete", (_event, id) =>
    api.deleteWalletAccount(id)
  );

  ipcMain.handle("profile:get", () => api.getProfile());
  ipcMain.handle("profile:save", (_event, profile) => api.saveProfile(profile));
  ipcMain.handle("profile:update", (_event, changes) =>
    api.updateProfile(changes)
  );
  ipcMain.handle("assistant-profile:get", () => api.getAssistantProfile());
  ipcMain.handle("assistant-profile:update", (_event, changes) =>
    api.updateAssistantProfile(changes)
  );
  ipcMain.handle("journals:list", (_event, filters) =>
    api.listJournals(filters)
  );
  ipcMain.handle("journals:get", (_event, type, periodKey) =>
    api.getJournal(type, periodKey)
  );
  ipcMain.handle("journals:material", (_event, from, to) =>
    api.getJournalMaterial(from, to)
  );
  ipcMain.handle("journals:save", (_event, journal) =>
    api.saveJournal(journal)
  );
  ipcMain.handle("journals:delete", (_event, id) => api.deleteJournal(id));
  ipcMain.handle("personality-events:list", (_event, filters) =>
    api.listPersonalityEvents(filters)
  );
  ipcMain.handle("personality-events:create", (_event, input) =>
    api.createPersonalityEvent(input)
  );
  ipcMain.handle("personality-events:delete", (_event, id) =>
    api.deletePersonalityEvent(id)
  );
  ipcMain.handle("personality-events:confirm", (_event, id) =>
    api.confirmPersonalityEvent(id)
  );
  ipcMain.handle("shared-memories:list", (_event, filters) =>
    api.listSharedMemories(filters)
  );
  ipcMain.handle("shared-memories:create", (_event, input) =>
    api.createSharedMemory(input)
  );
  ipcMain.handle("shared-memories:delete", (_event, id) =>
    api.deleteSharedMemory(id)
  );
  ipcMain.handle("shared-memories:confirm", (_event, id) =>
    api.confirmSharedMemory(id)
  );
  ipcMain.handle("preferences:list", (_event, filters) =>
    api.listPreferences(filters)
  );
  ipcMain.handle("preferences:save", (_event, preference) =>
    api.savePreference(preference)
  );
  ipcMain.handle("preferences:delete", (_event, id) =>
    api.deletePreference(id)
  );
  ipcMain.handle("memories:list", (_event, filters) =>
    api.listMemories(filters)
  );
  ipcMain.handle("memories:create", (_event, memory) =>
    api.createMemory(memory)
  );
  ipcMain.handle("memories:update", (_event, id, changes) =>
    api.updateMemory(id, changes)
  );
  ipcMain.handle("memories:confirm", (_event, id) => api.confirmMemory(id));
  ipcMain.handle("memories:delete", (_event, id) => api.deleteMemory(id));
  ipcMain.handle("memories:recall", (_event, query) =>
    api.recallMemories(query)
  );
  ipcMain.handle("memories:extract", (_event, payload) =>
    api.extractMemories(payload)
  );
  ipcMain.handle("memories:consolidate", () => api.consolidateMemories());
  ipcMain.handle("memories:settings:get", () => api.getMemorySettings());
  ipcMain.handle("memories:settings:save", (_event, settings) =>
    api.saveMemorySettings(settings)
  );
  ipcMain.handle("prompt-settings:get", () => api.getPromptSettings());
  ipcMain.handle("prompt-settings:save", (_event, settings) =>
    api.savePromptSettings(settings)
  );
  ipcMain.handle("prompt-settings:versions", () => api.listPromptVersions());
  ipcMain.handle("prompt-settings:restore", (_event, version) =>
    api.restorePromptVersion(version)
  );
  ipcMain.handle("time-awareness:context", (_event, input) =>
    api.getTimeAwarenessContext(input)
  );
  ipcMain.handle("xuan-mood:home", () => api.getXuanMoodHome());
  ipcMain.handle("xuan-mood:event", (_event, input) =>
    api.recordXuanMoodEvent(input)
  );
  ipcMain.handle("xuan-mood:refresh", () => api.refreshXuanMood());
  ipcMain.handle("album:moments:list", (_event, filters) =>
    api.listAlbumMoments(filters)
  );
  ipcMain.handle("album:moments:create", (_event, input) =>
    api.createAlbumMoment(input)
  );
  ipcMain.handle("album:moments:update", (_event, id, changes) =>
    api.updateAlbumMoment(id, changes)
  );
  ipcMain.handle("album:moments:hide", (_event, id) =>
    api.hideAlbumMoment(id)
  );
  ipcMain.handle("album:sources:add", (_event, id, source) =>
    api.addAlbumMomentSource(id, source)
  );
  ipcMain.handle("album:sources:candidates", (_event, filters) =>
    api.listAlbumSourceCandidates(filters)
  );
  ipcMain.handle("dreams:list", (_event, filters) => api.listDreams(filters));
  ipcMain.handle("assistant-gallery:list", (_event, filters) =>
    api.listAssistantGallery(filters)
  );
  ipcMain.handle("assistant-gallery:summary", (_event, filters) =>
    api.getAssistantGallerySummary(filters)
  );
  ipcMain.handle("assistant-gallery:page", (_event, filters) =>
    api.getAssistantGalleryPage(filters)
  );
  ipcMain.handle("dreams:get", (_event, id) => api.getDream(id));
  ipcMain.handle("dreams:get-by-date", (_event, dreamDate) =>
    api.getDreamByDate(dreamDate)
  );
  ipcMain.handle("dreams:material", (_event, from, to, limit) =>
    api.getDreamMaterial(from, to, limit)
  );
  ipcMain.handle("dreams:create", (_event, input) => api.createDream(input));
  ipcMain.handle("dreams:update", (_event, id, changes) =>
    api.updateDream(id, changes)
  );
  ipcMain.handle("dreams:delete", (_event, id) => api.deleteDream(id));
  ipcMain.handle("conversations:list", () => api.listConversations());
  ipcMain.handle("conversations:create", (_event, title) =>
    api.createConversation(title)
  );
  ipcMain.handle("conversations:get", (_event, id) => api.getConversation(id));
  ipcMain.handle("conversations:messages:save", (_event, id, messages) =>
    api.saveConversationMessages(id, messages)
  );
  ipcMain.handle("conversations:delete", (_event, id) =>
    api.deleteConversation(id)
  );
}

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }
  const win = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 900,
    minHeight: 650,
    icon: appIcon,
    frame: false,
    transparent: false,
    backgroundColor: "#f9f8ff",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  mainWindow = win;
  win.loadFile("auth.html");
  win.once("ready-to-show", () => win.show());
  win.on("close", (event) => {
    if (isQuitting) return;
    event.preventDefault();
    win.hide();
  });
  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else {
    mainWindow.show();
    mainWindow.focus();
  }
}

async function startDesktopControl() {
  desktopControlServer = await createDesktopControlServer(async (command) => {
    if (command === "status") {
      return {
        component: "desktop",
        pid: process.pid,
        version: app.getVersion(),
        healthy: Boolean(mainWindow && !mainWindow.isDestroyed()),
        cluster: latestClusterStatus
      };
    }
    if (command === "focus") {
      setImmediate(showMainWindow);
      return { focused: true };
    }
    if (command?.type === "mobile-hubs-status") {
      if (!currentUser || !api.token) return { authenticated: false, hubs: [] };
      const result = await loadMobileHubStatus({
        api: authenticatedLocalHubApi(),
        cachedCluster: latestClusterStatus
      });
      if (result.cluster) latestClusterStatus = result.cluster;
      return { authenticated: true, ...result };
    }
    if (command?.type === "mobile-hub-sync") {
      if (!currentUser || !api.token) throw new Error("请先在桌面端登录 AetherX。");
      const result = await api.synchronizeMobileHub(command.nodeId, await currentHubEndpoints());
      return { synchronized: true, ...result };
    }
    if (command?.type === "mobile-hub-switch") {
      if (!currentUser || !api.token) throw new Error("请先在桌面端登录 AetherX。");
      const result = await api.switchMobileHub(command.nodeId, await currentHubEndpoints());
      return { switching: true, ...result };
    }
    if (command === "stop") {
      setImmediate(() => {
        isQuitting = true;
        app.quit();
      });
      return { stopping: true };
    }
    throw new Error("不支持的桌面端控制指令");
  });
}

function createTray() {
  tray = new Tray(appIcon);
  tray.setToolTip("AetherX");
  tray.on("double-click", showMainWindow);
  rebuildTrayMenu();
}

function rebuildTrayMenu() {
  if (!tray) return;
  const supportsLoginItem = ["win32", "darwin"].includes(process.platform);
  const openAtLogin = supportsLoginItem
    ? app.getLoginItemSettings().openAtLogin
    : false;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "打开 AetherX", click: showMainWindow },
      { type: "separator" },
      {
        label: "开机自动启动",
        type: "checkbox",
        checked: openAtLogin,
        enabled: supportsLoginItem,
        click(item) {
          app.setLoginItemSettings({ openAtLogin: item.checked });
          rebuildTrayMenu();
        }
      },
      { type: "separator" },
      {
        label: "退出",
        click() {
          isQuitting = true;
          app.quit();
        }
      }
    ])
  );
}

function openPage(sender, file) {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || win.isDestroyed()) return;
  setImmediate(() => {
    if (!win.isDestroyed()) win.loadFile(file);
  });
}

function authenticatedLocalHubApi() {
  const token = authenticationToken ||
    (api.baseUrl === localHubServerUrl ? api.token : "");
  if (!token) throw new Error("请先在桌面端登录 AetherX。");
  return new XuanApiClient({ baseUrl: localHubServerUrl, token });
}

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  mobileHubLanDiscovery.start();
  authStore = new AuthStore(path.join(app.getPath("userData"), "auth.json"), safeStorage);
  const storedAuth = authStore.load();
  const authentication = selectAuthenticationSession(storedAuth, localHubServerUrl);
  authenticationServerUrl = authentication.serverUrl || localHubServerUrl;
  authenticationToken = authentication.token;
  api.setBaseUrl(authenticationServerUrl);
  api.setToken(authenticationToken);
  currentUser = authenticationToken ? storedAuth.user : null;
  hubRouting = storedAuth.routing;
  try {
    localHub = await startLocalHub({
      electronApp: app,
      baseUrl: localHubServerUrl,
      enableAdbReverse:
        !app.isPackaged && /^(1|true|on)$/i.test(process.env.AETHERX_ADB_REVERSE || ""),
      requestQuit: () => app.quit()
    });
  } catch (error) {
    console.error("Unable to start the bundled AetherX Hub.", error);
    dialog.showErrorBox(
      "AetherX Hub 启动失败",
      "本机数据服务没有成功启动。请确认 4318 端口未被其他程序占用，然后重新打开 AetherX。"
    );
  }
  registerIpcHandlers();
  await startDesktopControl();
  createTray();
  createWindow();
  app.on("activate", () => {
    showMainWindow();
  });
});

app.on("second-instance", showMainWindow);

app.on("before-quit", (event) => {
  isQuitting = true;
  desktopSync.stop();
  desktopControl.stop();
  if (!localHub?.owned || hubShutdownComplete) return;
  event.preventDefault();
  if (!hubShutdownPromise) {
    hubShutdownPromise = localHub
      .stop()
      .catch((error) => console.error("Unable to stop the bundled AetherX Hub.", error))
      .finally(() => {
        hubShutdownComplete = true;
        app.quit();
      });
  }
});

app.on("will-quit", () => {
  mobileHubLanDiscovery.close();
  if (desktopControlServer) desktopControlServer.close();
  desktopControlServer = null;
});
