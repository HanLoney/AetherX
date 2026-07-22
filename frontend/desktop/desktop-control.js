const net = require("node:net");
const os = require("node:os");

function getDesktopControlPipe(username = os.userInfo().username) {
  const owner = String(username || "user")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "user";
  return `\\\\.\\pipe\\aetherx-desktop-${owner}`;
}

function createDesktopControlServer(handler, pipeName = getDesktopControlPipe()) {
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let buffer = "";
    socket.on("data", async (chunk) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try {
        const request = JSON.parse(buffer.slice(0, newline));
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

module.exports = { createDesktopControlServer, getDesktopControlPipe };
