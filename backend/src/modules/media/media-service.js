const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const jpeg = require("jpeg-js");
const { HttpError } = require("../../lib/http-error");

const DATA_URL = /^data:(image\/(?:png|jpeg|webp|gif));base64,([a-z0-9+/=\s]+)$/i;
const EXTENSIONS = new Map([
  ["image/png", ".png"],
  ["image/jpeg", ".jpg"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"]
]);
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const PREVIEW_LONG_EDGE = 720;
const PREVIEW_QUALITY = 72;

class MediaService {
  constructor(repository, dataDir) {
    this.repository = repository;
    this.mediaDir = path.join(dataDir, "media");
    fs.mkdirSync(this.mediaDir, { recursive: true });
  }

  storeDataUrl(userId, source, options = {}) {
    const match = String(source || "").match(DATA_URL);
    if (!match) {
      throw new HttpError(400, "INVALID_MEDIA_DATA", "图片数据格式不受支持。");
    }
    const mimeType = match[1].toLowerCase();
    const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (!bytes.length || bytes.length > MAX_MEDIA_BYTES) {
      throw new HttpError(413, "MEDIA_TOO_LARGE", "图片大小超出限制。");
    }
    const contentHash = crypto.createHash("sha256").update(bytes).digest("hex");
    const existing = this.repository.findByHash(userId, contentHash);
    if (existing) {
      if (options.createPreview !== false && existing.mimeType === "image/jpeg") {
        this.openPreview(existing, path.join(this.mediaDir, existing.fileName));
        return this.repository.find(userId, existing.id);
      }
      return existing;
    }

    const extension = EXTENSIONS.get(mimeType);
    const fileName = `${crypto.randomUUID()}${extension}`;
    const filePath = path.join(this.mediaDir, fileName);
    fs.writeFileSync(filePath, bytes, { flag: "wx" });
    try {
      const asset = this.repository.create(userId, {
        mimeType,
        fileName,
        byteSize: bytes.length,
        contentHash
      });
      if (options.createPreview !== false && mimeType === "image/jpeg") {
        this.openPreview(asset, filePath);
        return this.repository.find(userId, asset.id);
      }
      return asset;
    } catch (error) {
      fs.rmSync(filePath, { force: true });
      const duplicate = this.repository.findByHash(userId, contentHash);
      if (duplicate) return duplicate;
      throw error;
    }
  }

  open(userId, id, variant = "original") {
    const asset = this.repository.find(userId, id);
    if (!asset) {
      throw new HttpError(404, "MEDIA_NOT_FOUND", "图片不存在或已被删除。");
    }
    const filePath = path.resolve(this.mediaDir, asset.fileName);
    if (path.dirname(filePath) !== path.resolve(this.mediaDir) || !fs.existsSync(filePath)) {
      throw new HttpError(404, "MEDIA_FILE_MISSING", "图片文件不存在。");
    }
    if (variant === "preview" && asset.mimeType === "image/jpeg") {
      return this.openPreview(asset, filePath);
    }
    return { ...asset, filePath };
  }

  openPreview(asset, originalPath) {
    if (asset.previewFileName) {
      const cachedPath = path.resolve(this.mediaDir, asset.previewFileName);
      if (path.dirname(cachedPath) === path.resolve(this.mediaDir) && fs.existsSync(cachedPath)) {
        return {
          ...asset,
          mimeType: "image/jpeg",
          byteSize: asset.previewByteSize,
          contentHash: `${asset.contentHash}-preview-v1`,
          filePath: cachedPath
        };
      }
    }

    try {
      const decoded = jpeg.decode(fs.readFileSync(originalPath), {
        useTArray: true,
        formatAsRGBA: true
      });
      const scale = Math.min(1, PREVIEW_LONG_EDGE / Math.max(decoded.width, decoded.height));
      if (scale >= 1) return { ...asset, filePath: originalPath };
      const width = Math.max(1, Math.round(decoded.width * scale));
      const height = Math.max(1, Math.round(decoded.height * scale));
      const resized = resizeRgba(decoded.data, decoded.width, decoded.height, width, height);
      const encoded = jpeg.encode({ data: resized, width, height }, PREVIEW_QUALITY).data;
      const previewFileName = `${asset.id}.preview.jpg`;
      const previewPath = path.join(this.mediaDir, previewFileName);
      fs.writeFileSync(previewPath, encoded);
      this.repository.savePreview(asset.id, previewFileName, encoded.length);
      return {
        ...asset,
        mimeType: "image/jpeg",
        byteSize: encoded.length,
        contentHash: `${asset.contentHash}-preview-v1`,
        previewFileName,
        previewByteSize: encoded.length,
        filePath: previewPath
      };
    } catch {
      return { ...asset, filePath: originalPath };
    }
  }

  migrateLegacyConversationImages() {
    let migrated = 0;
    for (const row of this.repository.legacyConversationImages()) {
      let payload;
      try {
        payload = JSON.parse(row.payload_json || "{}");
      } catch {
        continue;
      }
      const source = payload?.image?.source;
      if (typeof source !== "string" || !source.startsWith("data:image/")) continue;
      try {
        const asset = this.storeDataUrl(row.user_id, source, {
          createPreview: false
        });
        payload.image = {
          ...payload.image,
          mediaId: asset.id,
          mimeType: asset.mimeType
        };
        delete payload.image.source;
        this.repository.updateMessagePayload(row.id, payload);
        migrated += 1;
      } catch {
        // Keep malformed legacy data readable instead of blocking Hub startup.
      }
    }
    return migrated;
  }
}

function resizeRgba(source, sourceWidth, sourceHeight, targetWidth, targetHeight) {
  const target = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = sourceWidth / targetWidth;
  const yRatio = sourceHeight / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y + 0.5) * yRatio));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x + 0.5) * xRatio));
      const sourceOffset = (sourceY * sourceWidth + sourceX) * 4;
      const targetOffset = (y * targetWidth + x) * 4;
      target[targetOffset] = source[sourceOffset];
      target[targetOffset + 1] = source[sourceOffset + 1];
      target[targetOffset + 2] = source[sourceOffset + 2];
      target[targetOffset + 3] = 255;
    }
  }
  return target;
}

module.exports = { MediaService };
