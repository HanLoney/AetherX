const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { getControlPipe, requestControl } = require("./control-channel");

let diskFs = fs;
try {
  // Electron patches the regular fs module to traverse ASAR archives. Component
  // installation must copy app.asar as an opaque file, so use its raw fs bridge.
  diskFs = require("original-fs");
} catch {
  // Unit tests run in plain Node.js, where the regular fs implementation is raw.
}

const HUB_URL = "http://127.0.0.1:4318";

async function pathExists(target) {
  try {
    await diskFs.promises.access(target);
    return true;
  } catch {
    return false;
  }
}

async function readJson(target, fallback = {}) {
  try {
    return JSON.parse(await diskFs.promises.readFile(target, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(target, value) {
  await diskFs.promises.mkdir(path.dirname(target), { recursive: true });
  await diskFs.promises.writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function probeHub(baseUrl = HUB_URL, options = {}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 1400);
  try {
    const response = await (options.fetchImpl || globalThis.fetch)(`${baseUrl}/health`, {
      signal: controller.signal
    });
    if (!response.ok) return { healthy: false, latencyMs: Date.now() - startedAt };
    const payload = await response.json();
    return {
      healthy: payload?.data?.service === "aetherx-backend",
      latencyMs: Date.now() - startedAt
    };
  } catch {
    return { healthy: false, latencyMs: null };
  } finally {
    clearTimeout(timer);
  }
}

async function waitFor(check, expected, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (Boolean(await check()) === expected) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

class ComponentManager {
  constructor(options) {
    this.app = options.app;
    this.resourcesPath = options.resourcesPath;
    this.isPackaged = Boolean(options.isPackaged);
    this.onProgress = options.onProgress || (() => {});
    const roamingRoot = this.app.getPath("appData");
    const localRoot = process.env.LOCALAPPDATA || roamingRoot;
    this.paths = {
      stateDir: this.app.getPath("userData"),
      hubData: path.join(roamingRoot, "AetherX", "hub"),
      hubLogs: path.join(roamingRoot, "AetherX", "logs"),
      hubMarker: path.join(this.app.getPath("userData"), "components", "hub.json"),
      desktopInstall: path.join(localRoot, "Programs", "AetherX Desktop"),
      desktopMarker: path.join(localRoot, "Programs", "AetherX Desktop", ".aetherx-component.json"),
      desktopPayload: this.isPackaged
        ? path.join(this.resourcesPath, "payload", "desktop")
        : path.resolve(__dirname, "..", "desktop", "dist", "win-unpacked"),
      backendRoot: this.isPackaged
        ? path.join(this.resourcesPath, "backend")
        : path.resolve(__dirname, "..", "..", "backend")
    };
    this.desktopPipe = getControlPipe("desktop");
    this.hubPipe = getControlPipe("hub");
  }

  emit(component, phase, message) {
    this.onProgress({ component, phase, message });
  }

  async getDesktopControl() {
    try {
      const response = await requestControl(this.desktopPipe, "status", { timeoutMs: 700 });
      return response.ok && response.healthy ? response : null;
    } catch {
      return null;
    }
  }

  async getHubControl() {
    try {
      const response = await requestControl(this.hubPipe, "status", { timeoutMs: 700 });
      return response.ok && response.healthy ? response : null;
    } catch {
      return null;
    }
  }

  async getStatus() {
    const desktopExe = path.join(this.paths.desktopInstall, "AetherX.exe");
    const [desktopInstalled, desktopMarker, desktopControl, hubMarker, hubControl, hubHealth] =
      await Promise.all([
        pathExists(desktopExe),
        readJson(this.paths.desktopMarker),
        this.getDesktopControl(),
        readJson(this.paths.hubMarker),
        this.getHubControl(),
        probeHub()
      ]);
    const hubInstalled = Boolean(hubMarker.installed);
    const desktopRunning = Boolean(desktopControl);
    const hubRunning = hubHealth.healthy;
    return {
      checkedAt: new Date().toISOString(),
      overall: desktopRunning && hubRunning ? "healthy" : "attention",
      desktop: {
        installed: desktopInstalled,
        running: desktopRunning,
        healthy: desktopRunning,
        controllable: desktopRunning,
        pid: desktopControl?.pid || null,
        version: desktopMarker.version || desktopControl?.version || null,
        installDir: this.paths.desktopInstall,
        status: desktopRunning ? "running" : desktopInstalled ? "stopped" : "missing"
      },
      hub: {
        installed: hubInstalled,
        running: hubRunning,
        healthy: hubRunning,
        controllable: Boolean(hubControl),
        ownedByLauncher: Boolean(hubControl),
        pid: hubControl?.pid || null,
        version: hubMarker.version || null,
        latencyMs: hubHealth.latencyMs,
        url: HUB_URL,
        dataDir: this.paths.hubData,
        status: hubRunning ? "running" : hubInstalled ? "stopped" : "missing"
      }
    };
  }

  async installHub() {
    this.emit("hub", "installing", "正在准备 Hub 数据目录");
    await diskFs.promises.mkdir(this.paths.hubData, { recursive: true });
    await diskFs.promises.mkdir(this.paths.hubLogs, { recursive: true });
    const backendPackage = await readJson(path.join(this.paths.backendRoot, "package.json"));
    await writeJson(this.paths.hubMarker, {
      installed: true,
      version: backendPackage.version || "0.1.0",
      dataDir: this.paths.hubData
    });
    this.emit("hub", "installed", "Hub 已安装");
    return this.getStatus();
  }

  async startHub() {
    const status = await this.getStatus();
    if (!status.hub.installed) await this.installHub();
    if ((await probeHub()).healthy) return this.getStatus();
    this.emit("hub", "starting", "正在启动本地 Hub");
    const args = this.isPackaged
      ? ["--aetherx-hub"]
      : [this.app.getAppPath(), "--aetherx-hub"];
    const logFile = path.join(this.paths.hubLogs, "launcher-hub.log");
    await diskFs.promises.mkdir(this.paths.hubLogs, { recursive: true });
    const log = diskFs.openSync(logFile, "a");
    const child = spawn(process.execPath, args, {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", log, log],
      env: {
        ...process.env,
        AETHERX_LAUNCHER_HUB_DATA: this.paths.hubData,
        AETHERX_LAUNCHER_HUB_LOGS: this.paths.hubLogs,
        AETHERX_LAUNCHER_HUB_PIPE: this.hubPipe
      }
    });
    child.unref();
    diskFs.closeSync(log);
    const started = await waitFor(async () => (await probeHub()).healthy, true);
    if (!started) throw new Error(`Hub 启动超时，请查看日志：${logFile}`);
    this.emit("hub", "running", "Hub 运行正常");
    return this.getStatus();
  }

  async stopHub() {
    const status = await this.getStatus();
    if (!status.hub.running) return status;
    if (!status.hub.controllable) {
      throw new Error("当前 Hub 不是由启动器管理的实例，请在其所属程序中关闭");
    }
    this.emit("hub", "stopping", "正在安全关闭 Hub");
    const response = await requestControl(this.hubPipe, "stop", { timeoutMs: 1800 });
    if (!response.ok) throw new Error(response.error || "Hub 拒绝停止");
    const stopped = await waitFor(async () => (await probeHub()).healthy, false, 8000);
    if (!stopped) throw new Error("Hub 未能在预期时间内停止");
    this.emit("hub", "stopped", "Hub 已停止");
    return this.getStatus();
  }

  async installDesktop() {
    const payloadExe = path.join(this.paths.desktopPayload, "AetherX.exe");
    if (!(await pathExists(payloadExe))) {
      throw new Error("桌面端安装资源不存在，请先构建启动器载荷");
    }
    if (await this.getDesktopControl()) {
      throw new Error("安装或更新前请先在启动器中停止桌面端");
    }
    this.emit("desktop", "installing", "正在安装桌面端");
    const staging = `${this.paths.desktopInstall}.staging`;
    const backup = `${this.paths.desktopInstall}.previous`;
    await diskFs.promises.rm(staging, { recursive: true, force: true });
    await diskFs.promises.cp(this.paths.desktopPayload, staging, { recursive: true });
    await diskFs.promises.rm(backup, { recursive: true, force: true });
    if (await pathExists(this.paths.desktopInstall)) {
      await diskFs.promises.rename(this.paths.desktopInstall, backup);
    }
    try {
      await diskFs.promises.rename(staging, this.paths.desktopInstall);
      const payloadManifest = await readJson(
        path.join(this.paths.desktopInstall, ".aetherx-payload.json")
      );
      await writeJson(this.paths.desktopMarker, {
        installed: true,
        version: payloadManifest.version || "unknown"
      });
      await diskFs.promises.rm(backup, { recursive: true, force: true });
    } catch (error) {
      if (await pathExists(backup)) {
        await diskFs.promises.rm(this.paths.desktopInstall, { recursive: true, force: true });
        await diskFs.promises.rename(backup, this.paths.desktopInstall);
      }
      throw error;
    }
    this.emit("desktop", "installed", "桌面端已安装");
    return this.getStatus();
  }

  async startDesktop() {
    let status = await this.getStatus();
    if (!status.desktop.installed) {
      status = await this.installDesktop();
    }
    if (status.desktop.running) return status;
    if (!status.hub.running) await this.startHub();
    this.emit("desktop", "starting", "正在启动桌面端");
    const executable = path.join(this.paths.desktopInstall, "AetherX.exe");
    const child = spawn(executable, [], { detached: true, stdio: "ignore" });
    child.unref();
    const started = await waitFor(async () => Boolean(await this.getDesktopControl()), true);
    if (!started) throw new Error("桌面端启动超时");
    this.emit("desktop", "running", "桌面端运行正常");
    return this.getStatus();
  }

  async stopDesktop() {
    const status = await this.getStatus();
    if (!status.desktop.running) return status;
    this.emit("desktop", "stopping", "正在安全关闭桌面端");
    const response = await requestControl(this.desktopPipe, "stop", { timeoutMs: 1800 });
    if (!response.ok) throw new Error(response.error || "桌面端拒绝停止");
    const stopped = await waitFor(async () => Boolean(await this.getDesktopControl()), false, 8000);
    if (!stopped) throw new Error("桌面端未能在预期时间内停止");
    this.emit("desktop", "stopped", "桌面端已停止");
    return this.getStatus();
  }

  async deployAll() {
    await this.installHub();
    await this.installDesktop();
    await this.startHub();
    await this.startDesktop();
    return this.getStatus();
  }

  async startAll() {
    await this.startHub();
    await this.startDesktop();
    return this.getStatus();
  }

  async stopAll() {
    const desktop = await this.getDesktopControl();
    if (desktop) await this.stopDesktop();
    const hub = await this.getStatus();
    if (hub.hub.running && hub.hub.controllable) await this.stopHub();
    return this.getStatus();
  }
}

module.exports = { ComponentManager, HUB_URL, probeHub, waitFor };
