const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const net = require("node:net");
const test = require("node:test");
const {
  createDesktopControlServer,
  sendControlResponse
} = require("../desktop-control");

class ControlSocketStub extends EventEmitter {
  constructor(options = {}) {
    super();
    this.destroyed = Boolean(options.destroyed);
    this.writable = options.writable !== false;
    this.writableEnded = Boolean(options.writableEnded);
    this.throwOnEnd = options.throwOnEnd || null;
    this.responses = [];
  }

  end(response) {
    if (this.throwOnEnd) throw this.throwOnEnd;
    this.responses.push(response);
    this.writableEnded = true;
  }
}

test("桌面控制响应会吸收断开管道的 EPIPE", () => {
  const socket = new ControlSocketStub();
  assert.equal(sendControlResponse(socket, { ok: true }), true);
  assert.doesNotThrow(() => {
    const error = new Error("write EPIPE");
    error.code = "EPIPE";
    socket.emit("error", error);
  });
  assert.equal(socket.responses.length, 1);
});

test("桌面控制响应对已关闭和同步写入失败的管道保持幂等", () => {
  const closed = new ControlSocketStub({ writableEnded: true });
  assert.equal(sendControlResponse(closed, { ok: true }), false);
  assert.equal(closed.responses.length, 0);

  const error = new Error("write EPIPE");
  error.code = "EPIPE";
  const broken = new ControlSocketStub({ throwOnEnd: error });
  assert.doesNotThrow(() => sendControlResponse(broken, { ok: true }));
  assert.equal(sendControlResponse(broken, { ok: true }), false);
});

test("客户端提前断开时桌面控制服务不会因回写而崩溃", async () => {
  let resolveHandler;
  const handlerReady = new Promise((resolve) => { resolveHandler = resolve; });
  const server = await createDesktopControlServer(
    () => handlerReady.then(() => ({ healthy: true })),
    0
  );
  try {
    const { port } = server.address();
    await new Promise((resolve, reject) => {
      const client = net.createConnection({ host: "127.0.0.1", port }, () => {
        client.write(`${JSON.stringify({ command: "status" })}\n`);
        client.destroy();
        resolve();
      });
      client.once("error", reject);
    });
    resolveHandler();
    await new Promise((resolve) => setTimeout(resolve, 30));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
