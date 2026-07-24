const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { execFile, spawn } = require("node:child_process");
const { promisify } = require("node:util");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const { getControlPipe, requestControl } = require("./control-channel");
const { TailscaleManager } = require("./tailscale-manager");

const execFileAsync = promisify(execFile);

let diskFs = fs;
try {
  // Electron patches the regular fs module to traverse ASAR archives. Component
  // installation must copy app.asar as an opaque file, so use its raw fs bridge.
  diskFs = require("original-fs");
} catch {
  // Unit tests run in plain Node.js, where the regular fs implementation is raw.
}

const HUB_URL = "http://127.0.0.1:4318";
const HUB_START_TIMEOUT_MS = 60_000;
const HUB_PORT = 4318;

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

async function prepareHubLog(logFile, version) {
  const previousLog = path.join(path.dirname(logFile), "launcher-hub.previous.log");
  await diskFs.promises.mkdir(path.dirname(logFile), { recursive: true });
  try {
    await diskFs.promises.rm(previousLog, { force: true });
    if (await pathExists(logFile)) await diskFs.promises.rename(logFile, previousLog);
    await diskFs.promises.writeFile(
      logFile,
      `[${new Date().toISOString()}] AetherX Hub ${version || "unknown"} start requested\r\n`,
      "utf8"
    );
  } catch {
    await diskFs.promises.appendFile(
      logFile,
      `\r\n[${new Date().toISOString()}] AetherX Hub ${version || "unknown"} start requested\r\n`,
      "utf8"
    );
  }
}

async function waitForHubStartup(child, options = {}) {
  const probe = options.probe || probeHub;
  const timeoutMs = options.timeoutMs || HUB_START_TIMEOUT_MS;
  const deadline = Date.now() + timeoutMs;
  let exit = child.exitCode == null ? null : { code: child.exitCode, signal: child.signalCode };
  const onExit = (code, signal) => { exit = { code, signal }; };
  child.once("exit", onExit);
  try {
    while (Date.now() < deadline) {
      const health = await probe();
      if (health.healthy) return { started: true, health };
      if (exit) return { started: false, exit };
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    return { started: false, timedOut: true };
  } finally {
    child.removeListener("exit", onExit);
  }
}

async function inspectTcpPort(port = HUB_PORT, host = "127.0.0.1", timeoutMs = 500) {
  const occupied = await new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.setTimeout(timeoutMs, () => finish(false));
  });
  if (!occupied) return { occupied: false, pid: null, processName: "" };
  const owner = await findWindowsPortOwner(port);
  return { occupied: true, ...owner };
}

async function findWindowsPortOwner(port) {
  if (process.platform !== "win32") return { pid: null, processName: "" };
  try {
    const { stdout } = await execFileAsync("netstat.exe", ["-ano", "-p", "tcp"], {
      windowsHide: true,
      encoding: "utf8",
      maxBuffer: 2 * 1024 * 1024
    });
    let pid = null;
    for (const line of stdout.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[0].toUpperCase() !== "TCP") continue;
      if (columns[3].toUpperCase() !== "LISTENING") continue;
      const localPort = Number(columns[1].match(/:(\d+)$/)?.[1]);
      if (localPort === port) {
        pid = Number(columns[4]) || null;
        break;
      }
    }
    if (!pid) return { pid: null, processName: "" };
    let processName = "";
    try {
      const { stdout: taskOutput } = await execFileAsync(
        "tasklist.exe",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        { windowsHide: true, encoding: "utf8", maxBuffer: 256 * 1024 }
      );
      processName = taskOutput.match(/^"([^"]+)"/)?.[1] || "";
    } catch {}
    return { pid, processName };
  } catch {
    return { pid: null, processName: "" };
  }
}

function hubPortConflictError(portState) {
  const owner = portState?.pid
    ? `${portState.processName || "其他程序"}（PID ${portState.pid}）`
    : "其他程序";
  const error = new Error(`Hub 无法启动：端口 ${HUB_PORT} 正被 ${owner} 占用，请先关闭该程序。`);
  error.code = "HUB_PORT_CONFLICT";
  return error;
}

async function collectCopyEntries(sourceRoot) {
  const directories = [];
  const files = [];
  const links = [];
  let totalBytes = 0;

  async function visit(relativePath = "") {
    const source = path.join(sourceRoot, relativePath);
    const entries = await diskFs.promises.readdir(source, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = path.join(relativePath, entry.name);
      const childSource = path.join(sourceRoot, childRelative);
      if (entry.isDirectory()) {
        directories.push(childRelative);
        await visit(childRelative);
      } else if (entry.isSymbolicLink()) {
        links.push(childRelative);
      } else if (entry.isFile()) {
        const stat = await diskFs.promises.stat(childSource);
        files.push({ relativePath: childRelative, size: stat.size, mode: stat.mode });
        totalBytes += stat.size;
      }
    }
  }

  await visit();
  return { directories, files, links, totalBytes };
}

async function copyDirectoryWithProgress(sourceRoot, destinationRoot, onProgress = () => {}) {
  const manifest = await collectCopyEntries(sourceRoot);
  let copiedBytes = 0;
  await diskFs.promises.mkdir(destinationRoot, { recursive: true });
  for (const relativePath of manifest.directories) {
    await diskFs.promises.mkdir(path.join(destinationRoot, relativePath), { recursive: true });
  }
  for (const relativePath of manifest.links) {
    const target = await diskFs.promises.readlink(path.join(sourceRoot, relativePath));
    await diskFs.promises.symlink(target, path.join(destinationRoot, relativePath));
  }
  onProgress({ copiedBytes, totalBytes: manifest.totalBytes });
  for (const file of manifest.files) {
    const source = path.join(sourceRoot, file.relativePath);
    const destination = path.join(destinationRoot, file.relativePath);
    const tracker = new Transform({
      transform(chunk, _encoding, callback) {
        copiedBytes += chunk.length;
        onProgress({
          copiedBytes,
          totalBytes: manifest.totalBytes,
          relativePath: file.relativePath
        });
        callback(null, chunk);
      }
    });
    await pipeline(
      diskFs.createReadStream(source),
      tracker,
      diskFs.createWriteStream(destination)
    );
    await diskFs.promises.chmod(destination, file.mode).catch(() => {});
  }
  onProgress({ copiedBytes: manifest.totalBytes, totalBytes: manifest.totalBytes });
  return manifest;
}

function compareVersions(left, right) {
  const leftParts = String(left || "").split(".").map((value) => Number.parseInt(value, 10) || 0);
  const rightParts = String(right || "").split(".").map((value) => Number.parseInt(value, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
    if (difference !== 0) return difference;
  }
  return 0;
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
      latencyMs: Date.now() - startedAt,
      mobile: payload?.data?.mobile || null
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
    this.tailscale = options.tailscaleManager || new TailscaleManager();
  }

  emit(component, phase, message, percent = null, detail = {}) {
    this.onProgress({ component, phase, message, percent, ...detail });
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
    const payloadManifestPath = path.join(this.paths.desktopPayload, ".aetherx-payload.json");
    const [desktopInstalled, desktopMarker, desktopPayload, desktopControl, hubMarker, hubControl, hubHealth, hubPort] =
      await Promise.all([
        pathExists(desktopExe),
        readJson(this.paths.desktopMarker),
        readJson(payloadManifestPath),
        this.getDesktopControl(),
        readJson(this.paths.hubMarker),
        this.getHubControl(),
        probeHub(),
        inspectTcpPort()
      ]);
    const hubInstalled = Boolean(hubMarker.installed);
    const desktopRunning = Boolean(desktopControl);
    const hubRunning = hubHealth.healthy;
    const hubPortConflict = hubPort.occupied && !hubRunning;
    const installedDesktopVersion = desktopMarker.version || desktopControl?.version || null;
    const availableDesktopVersion = desktopPayload.version || installedDesktopVersion;
    const desktopUpdateAvailable = Boolean(
      desktopInstalled && availableDesktopVersion && (
        !installedDesktopVersion || compareVersions(availableDesktopVersion, installedDesktopVersion) > 0
      )
    );
    const remoteStatus = await this.tailscale.getStatus({ hubHealthy: hubRunning });
    const mobilePeers = (remoteStatus.tailscale?.peers || []).filter((peer) => peer.mobile);
    return {
      checkedAt: new Date().toISOString(),
      overall: desktopRunning && hubRunning ? "healthy" : "attention",
      desktop: {
        installed: desktopInstalled,
        running: desktopRunning,
        healthy: desktopRunning,
        controllable: desktopRunning,
        pid: desktopControl?.pid || null,
        version: installedDesktopVersion,
        availableVersion: availableDesktopVersion || null,
        updateAvailable: desktopUpdateAvailable,
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
        portConflict: hubPortConflict,
        portOwner: hubPortConflict ? {
          pid: hubPort.pid,
          processName: hubPort.processName
        } : null,
        url: HUB_URL,
        dataDir: this.paths.hubData,
        status: hubRunning ? "running" : hubPortConflict ? "conflict" : hubInstalled ? "stopped" : "missing"
      },
      mobile: {
        available: hubRunning,
        detailAvailable: Boolean(hubControl),
        clients: hubControl?.mobileClients || [],
        summary: hubHealth.mobile,
        tailscalePeers: mobilePeers,
        networkOnline: mobilePeers.some((peer) => peer.online)
      },
      ...remoteStatus
    };
  }

  async installHub() {
    try {
      this.emit("hub", "installing", "正在准备 Hub 数据目录", 12);
      await diskFs.promises.mkdir(this.paths.hubData, { recursive: true });
      await diskFs.promises.mkdir(this.paths.hubLogs, { recursive: true });
      this.emit("hub", "installing", "正在校验 Hub 运行资源", 52);
      const backendPackagePath = path.join(this.paths.backendRoot, "package.json");
      const backendEntry = path.join(this.paths.backendRoot, "src", "app.js");
      if (!(await pathExists(backendPackagePath)) || !(await pathExists(backendEntry))) {
        throw new Error("Hub 运行资源不完整，请重新安装启动器");
      }
      const backendPackage = await readJson(backendPackagePath);
      this.emit("hub", "installing", "正在写入 Hub 安装信息", 82);
      await writeJson(this.paths.hubMarker, {
        installed: true,
        version: backendPackage.version || "0.1.0",
        dataDir: this.paths.hubData
      });
      this.emit("hub", "installed", "Hub 已安装", 100);
      return this.getStatus();
    } catch (error) {
      this.emit("hub", "failed", "Hub 安装失败", null);
      throw error;
    }
  }

  async startHub() {
    const status = await this.getStatus();
    if (!status.hub.installed) await this.installHub();
    if ((await probeHub()).healthy) return this.getStatus();
    const hubPort = await inspectTcpPort();
    if (hubPort.occupied) throw hubPortConflictError(hubPort);
    this.emit("hub", "starting", "正在启动本地 Hub");
    const args = this.isPackaged
      ? ["--aetherx-hub"]
      : [this.app.getAppPath(), "--aetherx-hub"];
    const logFile = path.join(this.paths.hubLogs, "launcher-hub.log");
    await prepareHubLog(logFile, this.app.getVersion?.());
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
    diskFs.closeSync(log);
    const startup = await waitForHubStartup(child);
    if (!startup.started) {
      if (!startup.exit && child.exitCode == null && !child.killed) child.kill();
      if (startup.exit) {
        const exitReason = startup.exit.signal
          ? `信号 ${startup.exit.signal}`
          : `退出代码 ${startup.exit.code}`;
        throw new Error(`Hub 启动失败（${exitReason}），请查看日志：${logFile}`);
      }
      throw new Error(`Hub 在 60 秒内没有完成启动，已清理残留进程。请查看日志：${logFile}`);
    }
    child.unref();
    await diskFs.promises.appendFile(
      logFile,
      `[${new Date().toISOString()}] AetherX Hub started successfully, pid=${child.pid}, port=4318\r\n`,
      "utf8"
    );
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

  async openTailscale() {
    await this.tailscale.openClient();
    return this.getStatus();
  }

  async enableRemoteAccess() {
    if (!(await probeHub()).healthy) await this.startHub();
    this.emit("remote", "starting", "正在开启 Tailscale 私有远程访问");
    await this.tailscale.enable();
    this.emit("remote", "running", "手机远程入口已经就绪");
    return this.getStatus();
  }

  async disableRemoteAccess() {
    this.emit("remote", "stopping", "正在关闭 Tailscale 私有远程访问");
    await this.tailscale.disable();
    this.emit("remote", "stopped", "远程入口已关闭，Hub 仍可在本机使用");
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
    this.emit("desktop", "installing", "正在计算安装内容", 2);
    const staging = `${this.paths.desktopInstall}.staging`;
    const backup = `${this.paths.desktopInstall}.previous`;
    await diskFs.promises.rm(staging, { recursive: true, force: true });
    try {
      let lastPercent = -1;
      await copyDirectoryWithProgress(this.paths.desktopPayload, staging, (progress) => {
        const ratio = progress.totalBytes > 0 ? progress.copiedBytes / progress.totalBytes : 1;
        const percent = Math.min(88, Math.max(6, Math.round(6 + ratio * 82)));
        if (percent === lastPercent) return;
        lastPercent = percent;
        this.emit("desktop", "installing", "正在复制桌面端文件", percent, {
          copiedBytes: progress.copiedBytes,
          totalBytes: progress.totalBytes
        });
      });
      this.emit("desktop", "installing", "正在切换到新版本", 92);
      await diskFs.promises.rm(backup, { recursive: true, force: true });
      if (await pathExists(this.paths.desktopInstall)) {
        await diskFs.promises.rename(this.paths.desktopInstall, backup);
      }
      await diskFs.promises.rename(staging, this.paths.desktopInstall);
      const payloadManifest = await readJson(
        path.join(this.paths.desktopInstall, ".aetherx-payload.json")
      );
      this.emit("desktop", "installing", "正在保存安装信息", 97);
      await writeJson(this.paths.desktopMarker, {
        installed: true,
        version: payloadManifest.version || "unknown"
      });
      await diskFs.promises.rm(backup, { recursive: true, force: true });
    } catch (error) {
      await diskFs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
      if (await pathExists(backup)) {
        await diskFs.promises.rm(this.paths.desktopInstall, { recursive: true, force: true });
        await diskFs.promises.rename(backup, this.paths.desktopInstall);
      }
      this.emit("desktop", "failed", "桌面端安装失败", null);
      throw error;
    }
    this.emit("desktop", "installed", "桌面端已安装", 100);
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

module.exports = {
  ComponentManager,
  HUB_URL,
  HUB_START_TIMEOUT_MS,
  compareVersions,
  copyDirectoryWithProgress,
  inspectTcpPort,
  probeHub,
  waitForHubStartup,
  waitFor
};
