const QRCode = require("qrcode");

async function generatePairingQrDataUrl(value) {
  const content = String(value || "");
  if (!content || content.length > 4096) {
    throw new Error("二维码内容无效。");
  }
  return QRCode.toDataURL(content, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 360,
    color: { dark: "#514a61ff", light: "#ffffffff" }
  });
}

module.exports = { generatePairingQrDataUrl };
