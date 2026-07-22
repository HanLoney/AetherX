const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const test = require("node:test");
const { createControlServer, getControlPipe, requestControl } = require("../control-channel");
const { probeHub, waitFor } = require("../component-manager");

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
    response.end(JSON.stringify({ data: { service: "aetherx-backend" } }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    const status = await probeHub(`http://127.0.0.1:${address.port}`);
    assert.equal(status.healthy, true);
    assert.equal(typeof status.latencyMs, "number");
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

test("启动器界面提供完整的安装、启动、停止与监控入口", () => {
  const html = fs.readFileSync(path.join(launcherDir, "launcher.html"), "utf8");
  const script = fs.readFileSync(path.join(launcherDir, "launcher.js"), "utf8");
  const main = fs.readFileSync(path.join(launcherDir, "main.js"), "utf8");
  assert.match(html, /data-action="deploy-all"/);
  assert.match(html, /data-action="stop-all"/);
  assert.match(html, /data-component="hub"/);
  assert.match(html, /data-component="desktop"/);
  assert.match(script, /\$\{name\}-stop/);
  assert.match(main, /"hub-stop"/);
  assert.match(main, /"desktop-stop"/);
  assert.match(script, /onStatus/);
});
