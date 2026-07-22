const net = require("node:net");
const os = require("node:os");

function normalizePipeOwner(value = os.userInfo().username) {
  return String(value || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "user";
}

function getControlPipe(component, username) {
  const owner = normalizePipeOwner(username);
  const name = String(component || "component").replace(/[^a-z0-9_-]+/gi, "-");
  return `\\\\.\\pipe\\aetherx-${name}-${owner}`;
}

function requestControl(pipeName, command, options = {}) {
  const timeoutMs = options.timeoutMs || 1200;
  return new Promise((resolve, reject) => {
    let settled = false;
    let buffer = "";
    const socket = net.createConnection(pipeName);
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error("控制通道响应超时")), timeoutMs);
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ command })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        finish(null, JSON.parse(buffer.slice(0, newline)));
      } catch {
        finish(new Error("控制通道返回了无效数据"));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => {
      if (!settled) finish(new Error("控制通道已断开"));
    });
  });
}

function createControlServer(pipeName, handler) {
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      try {
        const request = JSON.parse(line);
        const result = await handler(request.command);
        socket.end(`${JSON.stringify({ ok: true, ...result })}\n`);
      } catch (error) {
        socket.end(`${JSON.stringify({ ok: false, error: error.message })}\n`);
      }
    });
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(pipeName, () => {
      server.removeListener("error", reject);
      resolve(server);
    });
  });
}

module.exports = {
  createControlServer,
  getControlPipe,
  normalizePipeOwner,
  requestControl
};
