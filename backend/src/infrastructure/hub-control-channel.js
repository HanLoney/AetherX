const net = require("node:net");
const os = require("node:os");
const path = require("node:path");

const CONTROL_SOCKET_ERROR_HANDLER = Symbol("aetherxControlSocketErrorHandler");

function normalizePipeOwner(value = os.userInfo().username) {
  return String(value || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "user";
}

function getHubControlPipe(username) {
  const owner = normalizePipeOwner(username);
  if (process.platform === "win32") return `\\\\.\\pipe\\aetherx-hub-${owner}`;
  return path.join(os.tmpdir(), `aetherx-hub-${owner}.sock`);
}

function requestHubControl(pipeName, command, options = {}) {
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
    const timer = setTimeout(
      () => finish(controlError("HUB_CONTROL_TIMEOUT", "Hub control channel timed out.")),
      timeoutMs
    );
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify({ command })}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        finish(null, JSON.parse(buffer.slice(0, newline)));
      } catch {
        finish(controlError("HUB_CONTROL_RESPONSE_INVALID", "Hub control channel returned invalid data."));
      }
    });
    socket.on("error", (error) => finish(error));
    socket.on("end", () => {
      if (!settled) finish(controlError("HUB_CONTROL_DISCONNECTED", "Hub control channel disconnected."));
    });
  });
}

function createHubControlServer(pipeName, handler) {
  const server = net.createServer((socket) => {
    guardControlSocket(socket);
    socket.setEncoding("utf8");
    let buffer = "";
    let handled = false;
    socket.on("data", async (chunk) => {
      if (handled) return;
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      handled = true;
      socket.pause();
      try {
        const request = JSON.parse(buffer.slice(0, newline));
        const result = await handler(request.command);
        sendControlResponse(socket, { ok: true, ...result });
      } catch (error) {
        sendControlResponse(socket, { ok: false, error: error.message, code: error.code || "" });
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

function guardControlSocket(socket) {
  if (!socket || typeof socket.on !== "function" || socket[CONTROL_SOCKET_ERROR_HANDLER]) return;
  socket[CONTROL_SOCKET_ERROR_HANDLER] = true;
  socket.on("error", () => {});
}

function sendControlResponse(socket, payload) {
  guardControlSocket(socket);
  if (!socket || socket.destroyed || !socket.writable || socket.writableEnded) return false;
  try {
    socket.end(`${JSON.stringify(payload)}\n`);
    return true;
  } catch {
    return false;
  }
}

function controlError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

module.exports = {
  createHubControlServer,
  getHubControlPipe,
  normalizePipeOwner,
  requestHubControl,
  sendControlResponse
};
