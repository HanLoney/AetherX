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
const path = require("node:path");
const { XuanApiClient } = require("./api-client");
const { AuthStore } = require("./auth-store");
const { startLocalHub } = require("./hub-runtime");
const { DesktopSyncCoordinator } = require("./sync-runtime");
const { generatePairingQrDataUrl } = require("./qr-code");
const { createDesktopControlServer } = require("./desktop-control");

const appIcon = path.join(__dirname, "app-icon-rounded.png");
const defaultServerUrl =
  process.env.AETHERX_SERVER_URL ||
  process.env.XUANAI_SERVER_URL ||
  "http://127.0.0.1:4318";
let authStore;
let mainWindow;
let currentUser = null;
let localHub = null;
let tray = null;
let isQuitting = false;
let hubShutdownComplete = false;
let hubShutdownPromise = null;
let desktopControlServer = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) app.quit();
const api = new XuanApiClient({
  baseUrl: defaultServerUrl,
  onUnauthorized: () => {
    if (!api.token || !authStore) return;
    api.setToken("");
    currentUser = null;
    desktopSync.stop();
    authStore.clearSession(api.baseUrl);
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.loadFile("auth.html");
  }
});
const desktopSync = new DesktopSyncCoordinator({
  api,
  onChanges: async (changes) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    mainWindow.webContents.send("sync:received", changes);
  }
});

async function startAuthenticatedSync() {
  if (!currentUser || !api.token) return;
  await desktopSync.start(`${api.baseUrl}|${currentUser.id}`);
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
    serverUrl: api.baseUrl,
    hasSession: Boolean(api.token),
    user: currentUser
  }));
  ipcMain.handle("auth:bootstrap", async (event) => {
    if (!api.token) return { authenticated: false };
    const session = await api.getSession();
    currentUser = session.user;
    authStore.save({ serverUrl: api.baseUrl, token: api.token, user: currentUser });
    await startAuthenticatedSync();
    openPage(event.sender, "home.html");
    return { authenticated: true, user: currentUser };
  });
  ipcMain.handle("auth:config", async (_event, serverUrl) => {
    const previousServerUrl = api.baseUrl;
    api.setBaseUrl(serverUrl);
    if (api.baseUrl !== previousServerUrl) {
      desktopSync.stop();
      api.setToken("");
      currentUser = null;
      authStore.clearSession(api.baseUrl);
    }
    return api.getAuthConfig();
  });
  ipcMain.handle("auth:login", async (event, input) => {
    api.setBaseUrl(input.serverUrl);
    api.setToken("");
    const result = await api.login({
      username: input.username,
      password: input.password
    });
    api.setToken(result.token);
    currentUser = result.user;
    authStore.save({ serverUrl: api.baseUrl, token: result.token, user: result.user });
    await startAuthenticatedSync();
    openPage(event.sender, "home.html");
    return { user: result.user };
  });
  ipcMain.handle("auth:register", async (event, input) => {
    api.setBaseUrl(input.serverUrl);
    api.setToken("");
    const result = await api.register({
      username: input.username,
      displayName: input.displayName,
      password: input.password,
      registrationSecret: input.registrationSecret
    });
    api.setToken(result.token);
    currentUser = result.user;
    authStore.save({ serverUrl: api.baseUrl, token: result.token, user: result.user });
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
  ipcMain.handle("auth:logout", async (event) => {
    try {
      if (api.token) await api.logout();
    } finally {
      desktopSync.stop();
      api.setToken("");
      currentUser = null;
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
  ipcMain.handle("devices:list", () => api.listDevices());
  ipcMain.handle("devices:revoke", (_event, id) => api.revokeDevice(id));
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

  ipcMain.handle("ai:config:get", () => api.getAiConfig());
  ipcMain.handle("ai:config:save", (_event, input) =>
    api.saveAiConfig(input)
  );
  ipcMain.handle("ai:chat", (_event, payload) => api.requestAi(payload));
  ipcMain.handle("agent:chat", (_event, payload) => api.agentChat(payload));
  ipcMain.handle("agent:approve", (_event, id, approved) =>
    api.approveAgentRun(id, approved)
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
        healthy: Boolean(mainWindow && !mainWindow.isDestroyed())
      };
    }
    if (command === "focus") {
      setImmediate(showMainWindow);
      return { focused: true };
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

if (hasSingleInstanceLock) app.whenReady().then(async () => {
  authStore = new AuthStore(path.join(app.getPath("userData"), "auth.json"), safeStorage);
  const storedAuth = authStore.load();
  if (storedAuth.serverUrl) api.setBaseUrl(storedAuth.serverUrl);
  api.setToken(storedAuth.token);
  currentUser = storedAuth.user;
  try {
    localHub = await startLocalHub({
      electronApp: app,
      baseUrl: api.baseUrl,
      enableAdbReverse: true
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
  if (desktopControlServer) desktopControlServer.close();
  desktopControlServer = null;
});
