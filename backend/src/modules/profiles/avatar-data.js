const { HttpError } = require("../../lib/http-error");

const AVATAR_PATTERN = /^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=\s]+)$/i;
const MAX_AVATAR_BYTES = 700 * 1024;
const MAX_PERSONA_IMAGE_BYTES = 4 * 1024 * 1024;

function normalizeAvatarDataUrl(value) {
  const dataUrl = String(value || "").trim();
  if (!dataUrl) return "";
  const match = dataUrl.match(AVATAR_PATTERN);
  if (!match) {
    throw new HttpError(
      400,
      "INVALID_AVATAR_FORMAT",
      "头像必须是 PNG、JPEG 或 WebP 图片。"
    );
  }
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_AVATAR_BYTES) {
    throw new HttpError(
      400,
      "INVALID_AVATAR_SIZE",
      "头像大小不能超过 700KB。"
    );
  }
  return `data:image/${match[1].toLowerCase()};base64,${match[2].replace(/\s/g, "")}`;
}

function normalizePersonaImageDataUrl(value) {
  const dataUrl = String(value || "").trim();
  if (!dataUrl) return "";
  const match = dataUrl.match(AVATAR_PATTERN);
  if (!match) {
    throw new HttpError(
      400,
      "INVALID_PERSONA_IMAGE_FORMAT",
      "人设图必须是 PNG、JPEG 或 WebP 图片。"
    );
  }
  const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
  if (!bytes.length || bytes.length > MAX_PERSONA_IMAGE_BYTES) {
    throw new HttpError(
      400,
      "INVALID_PERSONA_IMAGE_SIZE",
      "人设图大小不能超过 4MB。"
    );
  }
  return `data:image/${match[1].toLowerCase()};base64,${match[2].replace(/\s/g, "")}`;
}

module.exports = {
  MAX_AVATAR_BYTES,
  MAX_PERSONA_IMAGE_BYTES,
  normalizeAvatarDataUrl,
  normalizePersonaImageDataUrl
};
