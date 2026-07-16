const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {
  buildPairingCode,
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
  [
    "deviceManagerBtn",
    "deviceManagerMask",
    "generatePairingBtn",
    "pairingQrCode",
    "pairingRequest",
    "approvePairingBtn",
    "deviceList"
  ].forEach((id) => assert.match(html, new RegExp(`id="${id}"`)));
  assert.match(html, /<script src="device-manager\.js"><\/script>/);
});
