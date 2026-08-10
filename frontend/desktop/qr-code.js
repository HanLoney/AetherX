const QRCode = require("qrcode");

async function generatePairingQrDataUrl(value) {
  const content = String(value || "");
  if (!content || content.length > 4096) {
    throw new Error("二维码内容无效。");
  }
  const svg = await QRCode.toString(content, {
    type: "svg",
    errorCorrectionLevel: "Q",
    margin: 4,
    color: { dark: "#111111ff", light: "#ffffffff" }
  });
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

module.exports = { generatePairingQrDataUrl };
