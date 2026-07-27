const net = require("node:net");
const os = require("node:os");

const CONTROL_SOCKET_ERROR_HANDLER = Symbol("aetherxControlSocketErrorHandler");

function getDesktopControlPipe(username = os.userInfo().username) {
  const owner = String(username || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "user";
  return `\\\\.\\pipe\\aetherx-desktop-${owner}`;
}

function guardControlSocket(socket) {
  if (!socket || typeof socket.on !== "function") return;
  if (!socket[CONTROL_SOCKET_ERROR_HANDLER]) {
    socket[CONTROL_SOCKET_ERROR_HANDLER] = true;
    // A launcher probe can time out or close while the handler is still
    // resolving. Stream failures are connection-local and must never crash the
    // Electron main process.
    socket.on("error", () => {});
  }
}

function sendControlResponse(socket, payload) {
  if (!socket || typeof socket.end !== "function") return false;
  guardControlSocket(socket);
  if (socket.destroyed || !socket.writable || socket.writableEnded) return false;
  const response = `${JSON.stringify(payload)}\n`;
  try {
    socket.end(response);
    return true;
  } catch {
    return false;
  }
}

function createDesktopControlServer(handler, pipeName = getDesktopControlPipe()) {
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
        sendControlResponse(socket, { ok: false, error: error.message });
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

module.exports = { createDesktopControlServer, getDesktopControlPipe, sendControlResponse };
