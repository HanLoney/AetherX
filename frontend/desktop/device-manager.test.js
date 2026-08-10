const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildPairingCode,
  buildHubPairingCode,
  buildCompletePairingCode,
  combinePairingSessions,
  selectReachablePairingServer,
  selectReachablePairingServers,
  pairingView,
  formatCountdown
} = require("./device-manager");

test("连接码包含服务器、会话、密钥和过期时间", () => {
  const code = buildPairingCode(
    {
      id: "pairing-id",
      secret: "secret+/with symbols",
      expiresAt: 123456789
    },
    "https://api.aetherx.tech/"
  );
  const url = new URL(code);

  assert.equal(url.protocol, "aetherx:");
  assert.equal(url.hostname, "pair");
  assert.equal(url.searchParams.get("server"), "https://api.aetherx.tech");
  assert.equal(url.searchParams.get("id"), "pairing-id");
  assert.equal(url.searchParams.get("secret"), "secret+/with symbols");
  assert.equal(url.searchParams.get("expiresAt"), "123456789");
});

test("手机 Hub 配对码完整封装复制协议载荷", () => {
  const qrPayload = {
    protocolVersion: 1,
    schemaVersion: 39,
    spaceId: "space-1",
    sourceNodeId: "node-desktop",
    sessionId: "hub-pair-1",
    secret: "s".repeat(43),
    serverEphemeralPublicKey: "public-key",
    endpoints: [{ transport: "lan", address: "http://192.168.1.2:4318", priority: 200 }],
    expiresAt: 123456789
  };
  const code = buildHubPairingCode({ qrPayload });
  const url = new URL(code);
  const encoded = url.searchParams.get("payload");
  const decoded = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  assert.equal(url.hostname, "hub-pair");
  assert.deepEqual(decoded, qrPayload);
});

test("手机 Hub v2 短码只携带一次性解析引用", () => {
  const code = buildHubPairingCode({
    id: "hub-pair-1",
    secret: "h".repeat(43),
    expiresAt: 223456789
  }, "http://192.168.1.2:4318");
  const url = new URL(code);

  assert.equal(url.searchParams.get("v"), "2");
  assert.equal(url.searchParams.get("s"), "http://192.168.1.2:4318");
  assert.equal(url.searchParams.get("i"), "hub-pair-1");
  assert.equal(url.searchParams.get("k"), "h".repeat(43));
  assert.ok(code.length < 180);
});

test("一体化配对码同时封装客户端和手机 Hub 会话", () => {
  const client = {
    id: "client-pair-1",
    secret: "c".repeat(43),
    expiresAt: 223456789
  };
  const hub = {
    qrPayload: {
      protocolVersion: 1,
      schemaVersion: 42,
      spaceId: "space-1",
      sourceNodeId: "desktop-1",
      sessionId: "hub-pair-1",
      secret: "h".repeat(43),
      serverEphemeralPublicKey: "public-key",
      endpoints: [{ transport: "lan", address: "http://192.168.1.2:4318", priority: 500 }],
      expiresAt: 223456789
    }
  };
  const code = buildCompletePairingCode(client, [
    "http://127.0.0.1:4318",
    "http://192.168.1.2:4318",
    "https://hub.example.com"
  ], hub);
  const url = new URL(code);

  assert.equal(url.hostname, "complete-pair");
  assert.equal(url.searchParams.get("v"), "2");
  assert.deepEqual(url.searchParams.getAll("s"), [
    "http://127.0.0.1:4318",
    "http://192.168.1.2:4318",
    "https://hub.example.com"
  ]);
  assert.equal(url.searchParams.get("c"), "client-pair-1");
  assert.equal(url.searchParams.get("cs"), "c".repeat(43));
  assert.equal(url.searchParams.get("h"), "hub-pair-1");
  assert.equal(url.searchParams.get("hs"), "h".repeat(43));
  assert.ok(code.length < 390);
});

test("一体化配对等待两项申请后只需一次批准", () => {
  const client = { id: "client", status: "pending", expiresAt: 20_000, deviceName: "Android 手机" };
  const hub = { id: "hub", status: "created", expiresAt: 19_000, nodeName: "Android Local Hub" };
  assert.equal(combinePairingSessions(client, hub).status, "claiming");
  assert.equal(combinePairingSessions(client, { ...hub, status: "pending" }).status, "pending");
  assert.equal(combinePairingSessions({ ...client, status: "approved" }, { ...hub, status: "approved" }).status, "approved");
  assert.equal(combinePairingSessions({ ...client, status: "redeemed" }, { ...hub, status: "redeemed" }).status, "redeemed");
});

test("一体化客户端连接使用手机可达的最高优先级地址", () => {
  assert.equal(selectReachablePairingServer([
    { address: "https://hub.example.ts.net:4318", priority: 300 },
    { address: "http://192.168.1.20:4318", priority: 500 }
  ], "http://127.0.0.1:4318"), "http://192.168.1.20:4318");
  assert.deepEqual(selectReachablePairingServers([
    { address: "https://hub.example.ts.net:4318", priority: 300 },
    { address: "http://192.168.1.20:4318", priority: 500 }
  ], "http://127.0.0.1:4318"), [
    "http://127.0.0.1:4318",
    "http://192.168.1.20:4318",
    "https://hub.example.ts.net:4318"
  ]);
});

test("缺少服务器或配对凭证时拒绝生成连接码", () => {
  assert.throws(
    () => buildPairingCode({ id: "id", secret: "secret" }, "localhost:4318"),
    /缺少生成连接码/
  );
  assert.throws(
    () => buildPairingCode({ id: "id" }, "http://127.0.0.1:4318"),
    /缺少生成连接码/
  );
});

test("配对状态正确区分申请、批准、完成与过期", () => {
  const now = 10_000;
  assert.equal(pairingView({ status: "created", expiresAt: 20_000 }, now).state, "waiting");
  assert.equal(pairingView({ status: "pending", expiresAt: 20_000 }, now).state, "pending");
  assert.equal(pairingView({ status: "approved", expiresAt: 20_000 }, now).state, "approved");
  assert.equal(pairingView({ status: "redeemed", expiresAt: 5_000 }, now).state, "success");
  assert.equal(pairingView({ status: "created", expiresAt: 5_000 }, now).state, "expired");
});

test("连接码倒计时不会显示负数", () => {
  assert.equal(formatCountdown(191_000, 10_000), "03:01");
  assert.equal(formatCountdown(1_000, 10_000), "00:00");
});

test("桌面主页包含设备管理入口和完整配对面板", () => {
  const html = fs.readFileSync(path.join(__dirname, "home.html"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "home.css"), "utf8");
  const managerSource = fs.readFileSync(path.join(__dirname, "device-manager.js"), "utf8");
  [
    "deviceManagerBtn",
    "deviceManagerMask",
    "generateCompletePairingBtn",
    "pairingCodeLabel",
    "pairingQrCode",
    "pairingRequest",
    "approvePairingBtn",
    "deviceList"
  ].forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
  ["generatePairingBtn", "generateHubPairingBtn", "clientPairingModeBtn", "hubPairingModeBtn"]
    .forEach((id) => assert.doesNotMatch(html, new RegExp(`id="${id}"`)));
  assert.match(managerSource, /一体化配对码（aetherx:\/\/complete-pair）/);
  assert.match(managerSource, /getHubPairingEndpoints/);
  assert.match(managerSource, /dataset\.deleteDevice/);
  assert.match(managerSource, /deleteDeviceRecord/);
  assert.match(managerSource, /删除记录/);
  assert.match(css, /\.device-delete-button/);
  assert.match(css, /\.pairing-qr-wrap\s*\{[^}]*width:\s*260px;[^}]*height:\s*260px;/s);
  assert.match(html, /<script src="device-manager\.js"><\/script>/);
});
