const test = require("node:test");
const assert = require("node:assert/strict");
const { generatePairingQrDataUrl } = require("./qr-code");

test("配对连接码生成为高容错矢量二维码", async () => {
  const result = await generatePairingQrDataUrl(
    `aetherx://pair?server=${encodeURIComponent("https://api.aetherx.tech")}&id=test&secret=${"a".repeat(32)}`
  );
  assert.match(result, /^data:image\/svg\+xml;base64,/);
  assert.ok(result.length > 500);
  const svg = Buffer.from(result.split(",")[1], "base64").toString("utf8");
  assert.match(svg, /viewBox=/);
  assert.match(svg, /#111111/);
});

test("二维码生成拒绝空内容和异常长内容", async () => {
  await assert.rejects(generatePairingQrDataUrl(""), /二维码内容无效/);
  await assert.rejects(generatePairingQrDataUrl("a".repeat(4097)), /二维码内容无效/);
});
