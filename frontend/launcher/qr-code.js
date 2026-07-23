const QRCode = require("qrcode");

async function generateQrDataUrl(value) {
  const content = String(value || "").trim();
  if (!content || content.length > 4096) throw new Error("二维码内容无效");
  return QRCode.toDataURL(content, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 320,
    color: { dark: "#5c5368ff", light: "#ffffffff" }
  });
}

module.exports = { generateQrDataUrl };
