const { app, BrowserWindow, clipboard, ipcMain, shell } = require("electron");
const path = require("node:path");
const { ComponentManager } = require("./component-manager");
const { getControlPipe } = require("./control-channel");
const { runHubHost } = require("./hub-host");
const { generateQrDataUrl } = require("./qr-code");
const { TAILSCALE_DOWNLOAD_URL } = require("./tailscale-manager");

const isHubMode = process.argv.includes("--aetherx-hub");
if (isHubMode) app.disableHardwareAcceleration();
const iconPath = app.isPackaged
  ? path.join(__dirname, "app-icon-rounded.png")
  : path.resolve(__dirname, "..", "desktop", "app-icon-rounded.png");

if (isHubMode) {
  app.setName("AetherX Hub");
  app.whenReady().then(async () => {
    const backendRoot = app.isPackaged
      ? path.join(process.resourcesPath, "backend")
      : path.resolve(__dirname, "..", "..", "backend");
    const dataDir =
      process.env.AETHERX_LAUNCHER_HUB_DATA || path.join(app.getPath("appData"), "AetherX", "hub");
    const logDir =
      process.env.AETHERX_LAUNCHER_HUB_LOGS || path.join(app.getPath("appData"), "AetherX", "logs");
    const pipeName = process.env.AETHERX_LAUNCHER_HUB_PIPE || getControlPipe("hub");
    try {
      await runHubHost({
        app,
        backendRoot,
        dataDir,
        logDir,
        pipeName,
        host: process.env.AETHERX_HOST || "127.0.0.1",
        port: Number(process.env.AETHERX_PORT || 4318)
      });
      console.log(
        `[${new Date().toISOString()}] AetherX Hub is listening on ${process.env.AETHERX_HOST || "127.0.0.1"}:${Number(process.env.AETHERX_PORT || 4318)}`
      );
    } catch (error) {
      console.error("AetherX Hub 启动失败", error);
      app.exit(1);
    }
  });
} else {
  app.setName("AetherX 启动器");
  const hasLock = app.requestSingleInstanceLock();
  if (!hasLock) app.quit();

  let mainWindow = null;
  let manager = null;
  let monitorTimer = null;
  let checking = false;
  let runningAction = null;

  function send(channel, payload) {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
  }

  async function refreshStatus() {
    if (!manager || checking) return null;
    checking = true;
    try {
      const status = await manager.getStatus();
      send("launcher:status", status);
      return status;
    } finally {
      checking = false;
    }
  }

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1120,
      height: 760,
      minWidth: 920,
      minHeight: 650,
      frame: false,
      show: false,
      icon: iconPath,
      backgroundColor: "#f8f6fb",
      webPreferences: {
        preload: path.join(__dirname, "preload.js"),
        contextIsolation: true,
        nodeIntegration: false
      }
    });
    mainWindow.loadFile("launcher.html");
    mainWindow.once("ready-to-show", () => mainWindow.show());
    mainWindow.on("closed", () => {
      mainWindow = null;
      if (monitorTimer) clearInterval(monitorTimer);
      monitorTimer = null;
    });
  }

  function registerIpc() {
    ipcMain.on("window:minimize", () => mainWindow?.minimize());
    ipcMain.on("window:maximize", () => {
      if (!mainWindow) return;
      if (mainWindow.isMaximized()) mainWindow.unmaximize();
      else mainWindow.maximize();
    });
    ipcMain.on("window:close", () => mainWindow?.close());
    ipcMain.handle("launcher:status:get", () => refreshStatus());
    ipcMain.handle("launcher:qr:create", (_event, value) => generateQrDataUrl(value));
    ipcMain.handle("launcher:clipboard:write", (_event, value) => {
      clipboard.writeText(String(value || ""));
      return true;
    });
    ipcMain.handle("launcher:folder:open", async (_event, kind) => {
      const target = kind === "hub-data" ? manager.paths.hubData : manager.paths.desktopInstall;
      return shell.openPath(target);
    });
    ipcMain.handle("launcher:action", async (_event, action) => {
      const actions = {
        "deploy-all": () => manager.deployAll(),
        "start-all": () => manager.startAll(),
        "stop-all": () => manager.stopAll(),
        "hub-install": () => manager.installHub(),
        "hub-start": () => manager.startHub(),
        "hub-stop": () => manager.stopHub(),
        "desktop-install": () => manager.installDesktop(),
        "desktop-start": () => manager.startDesktop(),
        "desktop-stop": () => manager.stopDesktop(),
        "tailscale-download": async () => {
          await shell.openExternal(TAILSCALE_DOWNLOAD_URL);
          return manager.getStatus();
        },
        "tailscale-open": () => manager.openTailscale(),
        "remote-enable": () => manager.enableRemoteAccess(),
        "remote-disable": () => manager.disableRemoteAccess()
      };
      if (!actions[action]) throw new Error("未知的启动器操作");
      if (runningAction) throw new Error("另一个操作正在进行，请稍候");
      runningAction = action;
      send("launcher:busy", { busy: true, action });
      try {
        const status = await actions[action]();
        send("launcher:status", status);
        return status;
      } catch (error) {
        if (error?.actionUrl) await shell.openExternal(error.actionUrl);
        throw error;
      } finally {
        runningAction = null;
        send("launcher:busy", { busy: false, action });
      }
    });
  }

  if (hasLock) {
    app.whenReady().then(() => {
      manager = new ComponentManager({
        app,
        resourcesPath: process.resourcesPath,
        isPackaged: app.isPackaged,
        onProgress: (progress) => send("launcher:progress", progress)
      });
      registerIpc();
      createWindow();
      monitorTimer = setInterval(refreshStatus, 2000);
      refreshStatus();
    });
    app.on("second-instance", () => {
      if (!mainWindow) createWindow();
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    app.on("activate", () => {
      if (!mainWindow) createWindow();
    });
  }
}
