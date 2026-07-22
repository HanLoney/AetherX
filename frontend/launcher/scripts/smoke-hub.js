const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { requestControl } = require("../control-channel");

const launcherDir = path.resolve(__dirname, "..");
const executable = path.join(launcherDir, "dist", "win-unpacked", "AetherX 启动器.exe");
const port = 4329;
const pipeName = "\\\\.\\pipe\\aetherx-hub-smoke-4329";
const smokeRoot = path.join(launcherDir, "dist", "hub-smoke");

async function waitFor(check, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function probe() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();
    return response.ok && payload?.data?.service === "aetherx-backend";
  } catch {
    return false;
  }
}

async function main() {
  if (!fs.existsSync(executable)) throw new Error(`找不到打包后的启动器：${executable}`);
  fs.mkdirSync(smokeRoot, { recursive: true });
  let output = "";
  let exited = false;
  const child = spawn(executable, ["--aetherx-hub"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      AETHERX_HOST: "127.0.0.1",
      AETHERX_PORT: String(port),
      AETHERX_LAUNCHER_HUB_DATA: path.join(smokeRoot, "data"),
      AETHERX_LAUNCHER_HUB_LOGS: path.join(smokeRoot, "logs"),
      AETHERX_LAUNCHER_HUB_PIPE: pipeName
    }
  });
  child.stdout.on("data", (chunk) => { output += chunk; });
  child.stderr.on("data", (chunk) => { output += chunk; });
  child.on("exit", (code) => {
    exited = true;
    output += `\n[process exited with ${code}]`;
  });
  try {
    if (!(await waitFor(async () => exited || (await probe())))) {
      throw new Error(`隔离 Hub 未通过健康检查\n${output}`);
    }
    if (exited) throw new Error(`隔离 Hub 提前退出\n${output}`);
    const status = await requestControl(pipeName, "status", { timeoutMs: 2500 });
    if (!status.ok || !status.healthy || status.port !== port) {
      throw new Error("隔离 Hub 控制通道未返回健康状态");
    }
    const stopped = await requestControl(pipeName, "stop", { timeoutMs: 2500 });
    if (!stopped.ok || !stopped.stopping) throw new Error("隔离 Hub 拒绝安全停止");
    if (!(await waitFor(async () => !(await probe())))) throw new Error("隔离 Hub 未能停止");
    console.log(`Hub 冒烟测试通过：pid ${status.pid}，端口 ${status.port}`);
  } catch (error) {
    child.kill();
    throw error;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
