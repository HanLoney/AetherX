const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { createControlServer, getControlPipe, requestControl } = require("../control-channel");
const {
  HUB_START_TIMEOUT_MS,
  compareVersions,
  copyDirectoryWithProgress,
  inspectTcpPort,
  probeHub,
  waitForHubStartup,
  waitFor
} = require("../component-manager");
const {
  AETHERX_HUB_TARGET,
  REMOTE_HTTPS_PORT,
  TailscaleManager,
  inspectServeConfiguration,
  normalizeDnsName,
  parseTailscalePeers,
  tailscaleServeConsentUrl
} = require("../tailscale-manager");

const launcherDir = path.resolve(__dirname, "..");

test("本地控制通道可以确认健康状态并接收关闭指令", async () => {
  const pipe = getControlPipe(`test-${process.pid}`);
  let stopped = false;
  const server = await createControlServer(pipe, async (command) => {
    if (command === "status") return { healthy: true, pid: process.pid };
    if (command === "stop") {
      stopped = true;
      return { stopping: true };
    }
    throw new Error("unknown");
  });
  try {
    const status = await requestControl(pipe, "status");
    assert.equal(status.healthy, true);
    assert.equal(status.pid, process.pid);
    const stop = await requestControl(pipe, "stop");
    assert.equal(stop.stopping, true);
    assert.equal(stopped, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("Hub 健康检测验证服务身份并记录延迟", async () => {
  const server = http.createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({
      data: {
        service: "aetherx-backend",
        mobile: { tracked: 1, healthy: 1, lastHeartbeatAt: Date.now() }
      }
    }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const portState = await inspectTcpPort(address.port);
    assert.equal(portState.occupied, true);
    const status = await probeHub(`http://127.0.0.1:${address.port}`);
    assert.equal(status.healthy, true);
    assert.equal(typeof status.latencyMs, "number");
    assert.equal(status.mobile.tracked, 1);
    assert.equal(status.mobile.healthy, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("状态等待器可以观察组件从启动到停止", async () => {
  let value = false;
  setTimeout(() => { value = true; }, 20);
  assert.equal(await waitFor(() => value, true, 500), true);
  assert.equal(await waitFor(() => value, false, 60), false);
});

test("Hub 启动等待允许慢速首次启动，并能识别提前退出", async () => {
  const { EventEmitter } = require("node:events");
  const healthyChild = new EventEmitter();
  healthyChild.exitCode = null;
  let attempts = 0;
  const healthy = await waitForHubStartup(healthyChild, {
    timeoutMs: 1000,
    probe: async () => ({ healthy: ++attempts >= 3 })
  });
  assert.equal(healthy.started, true);
  assert.ok(HUB_START_TIMEOUT_MS >= 60_000);

  const exitedChild = new EventEmitter();
  exitedChild.exitCode = null;
  setTimeout(() => exitedChild.emit("exit", 1, null), 20);
  const exited = await waitForHubStartup(exitedChild, {
    timeoutMs: 1000,
    probe: async () => ({ healthy: false })
  });
  assert.deepEqual(exited.exit, { code: 1, signal: null });
});

test("桌面端安装复制会按实际字节报告进度", async (t) => {
  const source = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "aetherx-copy-source-"));
  const destination = `${source}-destination`;
  t.after(() => {
    fs.rmSync(source, { recursive: true, force: true });
    fs.rmSync(destination, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(source, "resources"), { recursive: true });
  fs.writeFileSync(path.join(source, "AetherX.exe"), Buffer.alloc(96 * 1024, 1));
  fs.writeFileSync(path.join(source, "resources", "app.asar"), Buffer.alloc(128 * 1024, 2));
  const updates = [];
  const manifest = await copyDirectoryWithProgress(source, destination, (progress) => {
    updates.push(progress);
  });
  assert.equal(manifest.totalBytes, 224 * 1024);
  assert.equal(updates.at(-1).copiedBytes, manifest.totalBytes);
  assert.deepEqual(fs.readFileSync(path.join(destination, "resources", "app.asar")), Buffer.alloc(128 * 1024, 2));
});

test("启动器可以识别桌面端的新版本", () => {
  assert.equal(compareVersions("1.2.5", "1.2.4") > 0, true);
  assert.equal(compareVersions("1.2.5", "1.2.5"), 0);
  assert.equal(compareVersions("1.3.0", "1.2.99") > 0, true);
});

test("启动器界面提供完整的安装、启动、停止与监控入口", () => {
  const html = fs.readFileSync(path.join(launcherDir, "launcher.html"), "utf8");
  const script = fs.readFileSync(path.join(launcherDir, "launcher.js"), "utf8");
  const main = fs.readFileSync(path.join(launcherDir, "main.js"), "utf8");
  const hubHost = fs.readFileSync(path.join(launcherDir, "hub-host.js"), "utf8");
  const manager = fs.readFileSync(path.join(launcherDir, "component-manager.js"), "utf8");
  assert.match(html, /data-action="deploy-all"/);
  assert.match(html, /data-action="stop-all"/);
  assert.match(html, /data-component="hub"/);
  assert.match(html, /data-component="desktop"/);
  assert.match(html, /data-component="remote"/);
  assert.match(html, /data-remote-qr/);
  assert.match(html, /data-mobile-clients/);
  assert.equal((html.match(/data-install-progress/g) || []).length, 2);
  assert.match(script, /data-progress-bar/);
  assert.match(script, /更新桌面端/);
  assert.match(script, /availableVersion/);
  assert.match(script, /portConflict/);
  assert.match(manager, /copyDirectoryWithProgress/);
  assert.match(manager, /desktopUpdateAvailable/);
  assert.match(manager, /prepareHubLog/);
  assert.match(manager, /HUB_PORT_CONFLICT/);
  assert.match(script, /\$\{name\}-stop/);
  assert.match(main, /"hub-stop"/);
  assert.match(main, /"desktop-stop"/);
  assert.match(main, /disableHardwareAcceleration/);
  assert.match(script, /onStatus/);
  assert.match(main, /"remote-enable"/);
  assert.match(main, /"remote-disable"/);
  assert.match(hubHost, /mobileClients: hub\.mobileHealth\(\)/);
  assert.match(manager, /hubControl\?\.mobileClients/);
  assert.match(manager, /summary: hubHealth\.mobile/);
});

test("Tailscale Serve 状态只识别属于 AetherX 的 HTTPS 转发", () => {
  const endpoint = "aetherx-home.example.ts.net:4318";
  const matched = inspectServeConfiguration({
    TCP: { [REMOTE_HTTPS_PORT]: { HTTPS: true } },
    Web: {
      [endpoint]: { Handlers: { "/": { Proxy: AETHERX_HUB_TARGET } } }
    }
  });
  assert.deepEqual(matched, {
    enabled: true,
    conflict: false,
    url: `https://${endpoint}`
  });

  const conflict = inspectServeConfiguration({
    TCP: { [REMOTE_HTTPS_PORT]: { HTTPS: true } },
    Web: {
      [endpoint]: { Handlers: { "/": { Proxy: "http://127.0.0.1:9000" } } }
    }
  });
  assert.equal(conflict.enabled, false);
  assert.equal(conflict.conflict, true);
});

test("Tailscale DNS 名称会移除状态输出里的末尾点号", () => {
  assert.equal(normalizeDnsName("aetherx-home.example.ts.net."), "aetherx-home.example.ts.net");
});

test("Tailscale 状态会识别在线的手机节点", () => {
  const peers = parseTailscalePeers({
    phone: {
      ID: "peer-1",
      HostName: "xiaomi-phone",
      OS: "android",
      Online: true,
      TailscaleIPs: ["100.64.0.20"]
    },
    laptop: { ID: "peer-2", HostName: "laptop", OS: "windows", Online: true }
  });
  assert.equal(peers.length, 2);
  assert.equal(peers[0].mobile, true);
  assert.equal(peers[0].online, true);
  assert.equal(peers[1].mobile, false);
});

test("Tailscale Serve 未授权时可以提取官方授权地址", () => {
  const url = "https://login.tailscale.com/f/serve?node=nNp54bsieM11CNTRL";
  assert.equal(
    tailscaleServeConsentUrl(`Serve is not enabled on your tailnet. To enable, visit: ${url}`),
    url
  );
  assert.equal(tailscaleServeConsentUrl("permission denied"), "");
});

test("Tailscale 管理器可以开启、检测并关闭 AetherX 私有入口", async () => {
  let serveEnabled = false;
  const calls = [];
  const endpoint = "aetherx-home.example.ts.net:4318";
  const execFileImpl = async (_executable, args) => {
    calls.push(args);
    if (args[0] === "version") return { stdout: JSON.stringify({ short: "1.90.0" }) };
    if (args[0] === "status") {
      return {
        stdout: JSON.stringify({
          BackendState: "Running",
          Self: { Online: true, DNSName: "aetherx-home.example.ts.net." },
          CurrentTailnet: { Name: "private-example" },
          TailscaleIPs: ["100.64.0.10"]
        })
      };
    }
    if (args[0] === "serve" && args[1] === "status") {
      return {
        stdout: JSON.stringify(serveEnabled ? {
          TCP: { [REMOTE_HTTPS_PORT]: { HTTPS: true } },
          Web: { [endpoint]: { Handlers: { "/": { Proxy: AETHERX_HUB_TARGET } } } }
        } : {})
      };
    }
    if (args[0] === "serve" && args.includes("--bg")) {
      serveEnabled = true;
      return { stdout: "" };
    }
    if (args[0] === "serve" && args.includes("off")) {
      serveEnabled = false;
      return { stdout: "" };
    }
    throw new Error(`unexpected command: ${args.join(" ")}`);
  };
  const manager = new TailscaleManager({
    executable: "tailscale.exe",
    execFileImpl,
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({ data: { service: "aetherx-backend" } })
    })
  });

  const enabled = await manager.enable();
  assert.equal(enabled.remote.enabled, true);
  assert.equal(enabled.remote.healthy, true);
  assert.equal(enabled.remote.url, `https://${endpoint}`);
  assert.ok(calls.some((args) => args.join(" ") === `serve --bg --yes --https=${REMOTE_HTTPS_PORT} ${AETHERX_HUB_TARGET}`));

  const disabled = await manager.disable();
  assert.equal(disabled.remote.enabled, false);
  assert.ok(calls.some((args) => args.join(" ") === `serve --https=${REMOTE_HTTPS_PORT} off`));
});
