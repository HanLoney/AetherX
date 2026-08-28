const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_PORT = 4318;

function resolvePort(value) {
  const port = Number.parseInt(String(value || DEFAULT_PORT), 10);
  return Number.isInteger(port) && port > 0 && port <= 65535
    ? port
    : DEFAULT_PORT;
}

function adbCandidates(env = process.env, platform = process.platform) {
  const executable = platform === "win32" ? "adb.exe" : "adb";
  return [
    env.ADB_PATH,
    env.ANDROID_HOME && path.join(env.ANDROID_HOME, "platform-tools", executable),
    env.ANDROID_SDK_ROOT && path.join(env.ANDROID_SDK_ROOT, "platform-tools", executable),
    platform === "win32" &&
      env.LOCALAPPDATA &&
      path.join(env.LOCALAPPDATA, "Android", "Sdk", "platform-tools", executable),
    executable
  ].filter(Boolean);
}

function findAdb(options = {}) {
  const env = options.env || process.env;
  const platform = options.platform || process.platform;
  const existsSync = options.existsSync || fs.existsSync;
  const candidates = adbCandidates(env, platform);
  return candidates.find((candidate) =>
    path.isAbsolute(candidate) ? existsSync(candidate) : true
  );
}

function parseConnectedDevices(output) {
  return String(output || "")
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 2 && parts[1] === "device")
    .map((parts) => parts[0]);
}

function ensureAdbReverse(options = {}) {
  const env = options.env || process.env;
  const run = options.spawnSync || spawnSync;
  const log = options.log || console.log;
  const warn = options.warn || console.warn;
  if (/^(0|false|off)$/i.test(String(env.AETHERX_ADB_REVERSE || ""))) {
    return { status: "disabled", devices: [] };
  }

  const adb = findAdb({
    env,
    platform: options.platform,
    existsSync: options.existsSync
  });
  if (!adb) return { status: "unavailable", devices: [] };

  const list = run(adb, ["devices"], {
    encoding: "utf8",
    timeout: 5000,
    windowsHide: true
  });
  if (list.error || list.status !== 0) {
    warn(`[AetherX] adb 暂时不可用，已跳过 USB 端口映射：${list.error?.message || list.stderr || "未知错误"}`);
    return { status: "unavailable", devices: [] };
  }

  const devices = parseConnectedDevices(list.stdout);
  if (!devices.length) {
    log("[AetherX] 未检测到已授权的 Android 设备，后端将正常启动。");
    return { status: "no-device", devices: [] };
  }

  const port = resolvePort(env.AETHERX_PORT);
  const connected = [];
  devices.forEach((serial) => {
    const result = run(
      adb,
      ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`],
      { encoding: "utf8", timeout: 5000, windowsHide: true }
    );
    if (result.error || result.status !== 0) {
      warn(`[AetherX] 设备 ${serial} 的 USB 端口映射失败：${result.error?.message || result.stderr || "未知错误"}`);
      return;
    }
    connected.push(serial);
  });

  if (connected.length) {
    log(`[AetherX] 已为 ${connected.length} 台 Android 设备打通 tcp:${port}。`);
  }
  return {
    status: connected.length === devices.length ? "ready" : "partial",
    devices: connected,
    port
  };
}

if (require.main === module) {
  try {
    ensureAdbReverse();
  } catch (error) {
    console.warn(`[AetherX] 自动配置 adb reverse 时遇到异常，后端仍会继续启动：${error.message}`);
  }
}

module.exports = {
  adbCandidates,
  ensureAdbReverse,
  findAdb,
  parseConnectedDevices,
  resolvePort
};
