const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { HttpError } = require("../../lib/http-error");

const DEFAULT_MANIFEST_LIMIT = 200;
const MAX_MANIFEST_LIMIT = 200;
const MEDIA_CHUNK_BYTES = 1024 * 1024;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024;
const SUPPORTED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif"
]);

class IncrementalMediaReplicationService {
  constructor({
    mediaRepository,
    stagingRepository,
    clusterService,
    clusterRepository,
    dataDir,
    now = () => Date.now()
  }) {
    this.mediaRepository = mediaRepository;
    this.stagingRepository = stagingRepository;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.mediaDir = path.join(dataDir, "media");
    this.stagingDir = path.join(dataDir, "replication-media-tmp");
    this.now = now;
    fs.mkdirSync(this.mediaDir, { recursive: true });
    fs.mkdirSync(this.stagingDir, { recursive: true });
  }

  getManifest(userId, peerNodeId, query = {}) {
    const context = this.assertSourcePeer(userId, peerNodeId);
    const cursor = decodeCursor(query.cursor);
    const limit = normalizeManifestLimit(query.limit);
    const rows = this.mediaRepository.listManifest(userId, cursor, limit + 1);
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit).map((asset) => {
      validateManifestAsset(asset);
      const filePath = safeChildPath(this.mediaDir, asset.fileName, "MEDIA_FILE_NAME_INVALID");
      let stat;
      try {
        stat = fs.statSync(filePath);
      } catch {
        throw new HttpError(409, "MEDIA_FILE_MISSING", "媒体原文件不存在，暂时无法同步。", {
          mediaId: asset.id
        });
      }
      if (!stat.isFile() || stat.size !== asset.byteSize) {
        throw new HttpError(409, "MEDIA_FILE_SIZE_MISMATCH", "媒体原文件大小与记录不一致。", {
          mediaId: asset.id
        });
      }
      return presentManifestAsset(asset);
    });
    const last = page.at(-1);
    return {
      spaceId: context.space_id,
      sourceNodeId: context.local_node_id,
      items: page,
      hasMore,
      nextCursor: last
        ? encodeCursor({ createdAt: last.createdAt, id: last.id })
        : encodeCursor(cursor)
    };
  }

  getBlobChunk(userId, peerNodeId, mediaId, query = {}) {
    this.assertSourcePeer(userId, peerNodeId);
    const asset = this.mediaRepository.find(userId, String(mediaId || ""));
    if (!asset) {
      throw new HttpError(404, "MEDIA_NOT_FOUND", "要同步的媒体不存在。");
    }
    validateManifestAsset(asset);
    const offset = normalizeByteOffset(query.offset, asset.byteSize);
    const requestedLength = normalizeChunkLength(query.length);
    const length = Math.min(requestedLength, asset.byteSize - offset);
    if (length <= 0) {
      throw new HttpError(416, "MEDIA_RANGE_INVALID", "媒体分块范围无效。");
    }
    const filePath = safeChildPath(this.mediaDir, asset.fileName, "MEDIA_FILE_NAME_INVALID");
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      throw new HttpError(404, "MEDIA_FILE_MISSING", "媒体原文件不存在。");
    }
    if (!stat.isFile() || stat.size !== asset.byteSize) {
      throw new HttpError(409, "MEDIA_FILE_SIZE_MISMATCH", "媒体原文件大小与记录不一致。");
    }
    const descriptor = fs.openSync(filePath, "r");
    try {
      const bytes = Buffer.alloc(length);
      const read = fs.readSync(descriptor, bytes, 0, length, offset);
      const result = read === length ? bytes : bytes.subarray(0, read);
      if (!result.length) {
        throw new HttpError(416, "MEDIA_RANGE_INVALID", "媒体分块范围无效。");
      }
      return {
        bytes: result,
        offset,
        byteSize: asset.byteSize,
        contentHash: asset.contentHash,
        chunkHash: sha256(result)
      };
    } finally {
      fs.closeSync(descriptor);
    }
  }

  async synchronizeFromPeer(userId, sourceNodeId, peerTransport, options = {}) {
    const context = this.clusterService.ensureSpace(userId);
    this.assertTargetSource(context, sourceNodeId);
    let cursor = "";
    let discovered = 0;
    let transferred = 0;
    let skipped = 0;
    let pages = 0;
    for (;;) {
      throwIfAborted(options.signal);
      const suffix = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
      const response = await peerTransport.requestJson(userId, sourceNodeId, {
        method: "GET",
        path: `/api/v1/peer/media/manifest?limit=${DEFAULT_MANIFEST_LIMIT}${suffix}`,
        signal: options.signal
      });
      const manifest = validateManifestResponse(response.data, context, sourceNodeId);
      pages += 1;
      for (const item of manifest.items) {
        throwIfAborted(options.signal);
        discovered += 1;
        const result = await this.synchronizeAsset(
          userId,
          context,
          sourceNodeId,
          item,
          peerTransport,
          options.signal
        );
        if (result === "transferred") transferred += 1;
        else skipped += 1;
      }
      if (!manifest.hasMore) break;
      if (!manifest.items.length || manifest.nextCursor === cursor) {
        throw new HttpError(502, "MEDIA_MANIFEST_CURSOR_STALLED", "媒体清单游标没有继续前进。");
      }
      cursor = manifest.nextCursor;
    }
    return {
      discovered,
      transferred,
      skipped,
      pages,
      ...this.status(userId, sourceNodeId)
    };
  }

  receiveChunk(userId, sourceNodeId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    this.assertTargetSource(context, sourceNodeId);
    const item = input.item;
    validateManifestAsset(item);
    const existing = this.mediaRepository.find(userId, item.id);
    if (existing) {
      this.assertExistingAsset(userId, existing, item);
      this.removeStaging(context.space_id, sourceNodeId, item.id);
      return { completed: true, receivedBytes: item.byteSize, item: presentManifestAsset(item) };
    }
    const encoded = String(input.bytes || "");
    let bytes;
    try {
      bytes = Buffer.from(encoded, "base64");
    } catch {
      throw new HttpError(400, "MEDIA_CHUNK_INVALID", "媒体分块不是有效的 Base64 数据。");
    }
    if (
      !bytes.length ||
      bytes.length > MEDIA_CHUNK_BYTES ||
      encoded.replace(/=+$/, "") !== bytes.toString("base64").replace(/=+$/, "") ||
      sha256(bytes) !== String(input.chunkHash || "")
    ) {
      throw new HttpError(409, "MEDIA_CHUNK_INVALID", "媒体分块内容校验失败。");
    }
    let staging = this.stagingRepository.find(context.space_id, sourceNodeId, item.id);
    if (staging) assertStagingMatches(staging, item);
    else {
      staging = this.stagingRepository.create({
        spaceId: context.space_id,
        sourceNodeId,
        mediaId: item.id,
        mimeType: item.mimeType,
        fileName: item.fileName,
        byteSize: item.byteSize,
        contentHash: item.contentHash,
        createdAt: item.createdAt,
        tempFileName: `${randomUUID()}.part`,
        updatedAt: this.now()
      });
    }
    const tempPath = safeChildPath(this.stagingDir, staging.tempFileName, "MEDIA_STAGING_FILE_INVALID");
    const actualOffset = reconcileStagingFile(tempPath, item.byteSize);
    const offset = normalizeUploadOffset(input.offset, item.byteSize);
    if (offset !== actualOffset || offset + bytes.length > item.byteSize) {
      throw new HttpError(409, "MEDIA_CHUNK_OFFSET_MISMATCH", "媒体分块偏移与接收进度不一致。", {
        expectedOffset: actualOffset,
        receivedOffset: offset
      });
    }
    fs.appendFileSync(tempPath, bytes, { flag: "a" });
    const receivedBytes = offset + bytes.length;
    this.stagingRepository.updateProgress(
      context.space_id,
      sourceNodeId,
      item.id,
      receivedBytes,
      receivedBytes === item.byteSize ? "verifying" : "downloading",
      this.now()
    );
    if (receivedBytes < item.byteSize) {
      return { completed: false, receivedBytes, item: presentManifestAsset(item) };
    }
    if (sha256File(tempPath) !== item.contentHash) {
      this.stagingRepository.updateProgress(
        context.space_id,
        sourceNodeId,
        item.id,
        receivedBytes,
        "invalid",
        this.now()
      );
      throw new HttpError(409, "MEDIA_CONTENT_HASH_MISMATCH", "媒体原文件完整性校验失败。");
    }
    this.promote(userId, context.space_id, sourceNodeId, item, tempPath);
    return { completed: true, receivedBytes, item: presentManifestAsset(item) };
  }

  receiveStatus(userId, sourceNodeId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    this.assertTargetSource(context, sourceNodeId);
    const items = Array.isArray(input.items) ? input.items : [];
    if (items.length > MAX_MANIFEST_LIMIT) {
      throw new HttpError(400, "MEDIA_MANIFEST_LIMIT_INVALID", "单次媒体状态查询过多。");
    }
    return {
      items: items.map((item) => {
        validateManifestAsset(item);
        const existing = this.mediaRepository.find(userId, item.id);
        if (existing) {
          this.assertExistingAsset(userId, existing, item);
          return { id: item.id, completed: true, receivedBytes: item.byteSize };
        }
        const staging = this.stagingRepository.find(context.space_id, sourceNodeId, item.id);
        if (staging) assertStagingMatches(staging, item);
        return {
          id: item.id,
          completed: false,
          receivedBytes: staging?.receivedBytes || 0
        };
      })
    };
  }

  async synchronizeAsset(userId, context, sourceNodeId, item, peerTransport, signal) {
    validateManifestAsset(item);
    const existing = this.mediaRepository.find(userId, item.id);
    if (existing) {
      this.assertExistingAsset(userId, existing, item);
      this.removeStaging(context.space_id, sourceNodeId, item.id);
      return "skipped";
    }
    const duplicate = this.mediaRepository.findByHash(userId, item.contentHash);
    if (duplicate) {
      throw new HttpError(
        409,
        "MEDIA_IDENTITY_CONFLICT",
        "本机已有相同内容但媒体 ID 不一致，已停止同步。",
        { sourceMediaId: item.id, localMediaId: duplicate.id }
      );
    }

    let staging = this.stagingRepository.find(context.space_id, sourceNodeId, item.id);
    if (staging) assertStagingMatches(staging, item);
    else {
      staging = this.stagingRepository.create({
        spaceId: context.space_id,
        sourceNodeId,
        mediaId: item.id,
        mimeType: item.mimeType,
        fileName: item.fileName,
        byteSize: item.byteSize,
        contentHash: item.contentHash,
        createdAt: item.createdAt,
        tempFileName: `${randomUUID()}.part`,
        updatedAt: this.now()
      });
    }
    const tempPath = safeChildPath(
      this.stagingDir,
      staging.tempFileName,
      "MEDIA_STAGING_FILE_INVALID"
    );
    let offset = reconcileStagingFile(tempPath, staging.byteSize);
    if (offset !== staging.receivedBytes || staging.status !== "downloading") {
      staging = this.stagingRepository.updateProgress(
        context.space_id,
        sourceNodeId,
        item.id,
        offset,
        "downloading",
        this.now()
      );
    }
    while (offset < item.byteSize) {
      throwIfAborted(signal);
      const response = await peerTransport.requestBinary(userId, sourceNodeId, {
        method: "GET",
        path:
          `/api/v1/peer/media/${encodeURIComponent(item.id)}/blob` +
          `?offset=${offset}&length=${MEDIA_CHUNK_BYTES}`,
        signal
      });
      validateChunkResponse(response, item, offset);
      fs.appendFileSync(tempPath, response.data, { flag: "a" });
      offset += response.data.length;
      staging = this.stagingRepository.updateProgress(
        context.space_id,
        sourceNodeId,
        item.id,
        offset,
        offset === item.byteSize ? "verifying" : "downloading",
        this.now()
      );
    }
    if (sha256File(tempPath) !== item.contentHash) {
      this.stagingRepository.updateProgress(
        context.space_id,
        sourceNodeId,
        item.id,
        offset,
        "invalid",
        this.now()
      );
      throw new HttpError(409, "MEDIA_CONTENT_HASH_MISMATCH", "媒体原文件完整性校验失败。", {
        mediaId: item.id
      });
    }
    this.promote(userId, context.space_id, sourceNodeId, item, tempPath);
    return "transferred";
  }

  promote(userId, spaceId, sourceNodeId, item, tempPath) {
    const destination = safeChildPath(this.mediaDir, item.fileName, "MEDIA_FILE_NAME_INVALID");
    let moved = false;
    if (fs.existsSync(destination)) {
      const stat = fs.statSync(destination);
      if (!stat.isFile() || stat.size !== item.byteSize || sha256File(destination) !== item.contentHash) {
        throw new HttpError(409, "MEDIA_FILE_COLLISION", "本机已有同名但内容不同的媒体文件。", {
          mediaId: item.id,
          fileName: item.fileName
        });
      }
    } else {
      fs.renameSync(tempPath, destination);
      moved = true;
    }
    try {
      this.mediaRepository.transaction(() => {
        const concurrent = this.mediaRepository.find(userId, item.id);
        if (concurrent) {
          assertAssetMetadataMatches(concurrent, item);
          return;
        }
        const duplicate = this.mediaRepository.findByHash(userId, item.contentHash);
        if (duplicate) {
          throw new HttpError(409, "MEDIA_IDENTITY_CONFLICT", "媒体内容哈希已属于另一个媒体 ID。");
        }
        this.mediaRepository.createReplicated(userId, item);
      });
    } catch (error) {
      if (moved && fs.existsSync(destination)) fs.renameSync(destination, tempPath);
      throw error;
    }
    fs.rmSync(tempPath, { force: true });
    this.stagingRepository.delete(spaceId, sourceNodeId, item.id);
  }

  assertExistingAsset(userId, existing, item) {
    assertAssetMetadataMatches(existing, item);
    const filePath = safeChildPath(this.mediaDir, existing.fileName, "MEDIA_FILE_NAME_INVALID");
    if (
      !fs.existsSync(filePath) ||
      !fs.statSync(filePath).isFile() ||
      fs.statSync(filePath).size !== existing.byteSize
    ) {
      throw new HttpError(409, "MEDIA_LOCAL_INTEGRITY_MISMATCH", "本机媒体记录与原文件不一致。", {
        mediaId: existing.id
      });
    }
  }

  status(userId, sourceNodeId) {
    const context = this.clusterService.ensureSpace(userId);
    return this.stagingRepository.summary(context.space_id, sourceNodeId);
  }

  removeStaging(spaceId, sourceNodeId, mediaId) {
    const staging = this.stagingRepository.find(spaceId, sourceNodeId, mediaId);
    if (!staging) return;
    const tempPath = safeChildPath(
      this.stagingDir,
      staging.tempFileName,
      "MEDIA_STAGING_FILE_INVALID"
    );
    fs.rmSync(tempPath, { force: true });
    this.stagingRepository.delete(spaceId, sourceNodeId, mediaId);
  }

  assertSourcePeer(userId, peerNodeId) {
    const context = this.clusterService.ensureSpace(userId);
    if (
      context.local_node_id !== context.active_node_id ||
      !allowsMediaReplication(context.state)
    ) {
      throw new HttpError(409, "MEDIA_SOURCE_NOT_ACTIVE", "只有当前活动 Hub 可以提供媒体增量同步。");
    }
    const peer = this.clusterRepository.findNode(context.space_id, String(peerNodeId || ""));
    if (!peer || peer.revoked_at !== null || peer.id === context.local_node_id) {
      throw new HttpError(403, "MEDIA_PEER_NOT_TRUSTED", "请求媒体同步的 Hub 不受信任。");
    }
    return context;
  }

  assertTargetSource(context, sourceNodeId) {
    const source = this.clusterRepository.findNode(context.space_id, String(sourceNodeId || ""));
    if (
      context.local_node_id === context.active_node_id ||
      context.active_node_id !== sourceNodeId ||
      !allowsMediaReplication(context.state) ||
      !source ||
      source.revoked_at !== null
    ) {
      throw new HttpError(409, "MEDIA_REPLICATION_ROLE_INVALID", "当前 Hub 不能从这个节点同步媒体。");
    }
  }
}

function allowsMediaReplication(state) {
  return ["stable", "draining", "final_sync"].includes(state);
}

function validateManifestResponse(value, context, sourceNodeId) {
  if (
    !value ||
    value.spaceId !== context.space_id ||
    value.sourceNodeId !== sourceNodeId ||
    !Array.isArray(value.items) ||
    typeof value.hasMore !== "boolean" ||
    typeof value.nextCursor !== "string"
  ) {
    throw new HttpError(502, "MEDIA_MANIFEST_INVALID", "活动 Hub 返回了无效的媒体清单。");
  }
  for (const item of value.items) validateManifestAsset(item);
  return value;
}

function validateManifestAsset(asset) {
  if (
    !asset ||
    !isIdentifier(asset.id) ||
    !SUPPORTED_MIME_TYPES.has(asset.mimeType) ||
    !isSafeFileName(asset.fileName) ||
    !Number.isSafeInteger(asset.byteSize) ||
    asset.byteSize < 1 ||
    asset.byteSize > MAX_MEDIA_BYTES ||
    !/^[a-f0-9]{64}$/.test(asset.contentHash || "") ||
    !Number.isSafeInteger(asset.createdAt) ||
    asset.createdAt < 0
  ) {
    throw new HttpError(502, "MEDIA_MANIFEST_ITEM_INVALID", "媒体清单包含无效条目。");
  }
}

function presentManifestAsset(asset) {
  return {
    id: asset.id,
    mimeType: asset.mimeType,
    fileName: asset.fileName,
    byteSize: asset.byteSize,
    contentHash: asset.contentHash,
    createdAt: asset.createdAt
  };
}

function validateChunkResponse(response, item, offset) {
  const headers = response.headers || {};
  const bytes = response.data;
  if (
    !Buffer.isBuffer(bytes) ||
    !bytes.length ||
    bytes.length > MEDIA_CHUNK_BYTES ||
    offset + bytes.length > item.byteSize ||
    headers["x-aetherx-blob-hash"] !== item.contentHash ||
    headers["x-aetherx-chunk-hash"] !== sha256(bytes) ||
    Number(headers["x-aetherx-blob-offset"]) !== offset ||
    Number(headers["x-aetherx-blob-size"]) !== item.byteSize
  ) {
    throw new HttpError(502, "MEDIA_CHUNK_RESPONSE_INVALID", "活动 Hub 返回了无效的媒体分块。");
  }
}

function assertAssetMetadataMatches(asset, item) {
  if (
    asset.id !== item.id ||
    asset.mimeType !== item.mimeType ||
    asset.fileName !== item.fileName ||
    asset.byteSize !== item.byteSize ||
    asset.contentHash !== item.contentHash ||
    asset.createdAt !== item.createdAt
  ) {
    throw new HttpError(409, "MEDIA_METADATA_CONFLICT", "同一媒体 ID 的元数据不一致。", {
      mediaId: item.id
    });
  }
}

function assertStagingMatches(staging, item) {
  if (
    staging.mimeType !== item.mimeType ||
    staging.fileName !== item.fileName ||
    staging.byteSize !== item.byteSize ||
    staging.contentHash !== item.contentHash ||
    staging.createdAt !== item.createdAt
  ) {
    throw new HttpError(409, "MEDIA_STAGING_CONFLICT", "未完成的媒体分块与活动 Hub 清单不一致。", {
      mediaId: item.id
    });
  }
}

function reconcileStagingFile(filePath, byteSize) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, Buffer.alloc(0), { flag: "wx" });
    return 0;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile() || stat.size > byteSize) {
    throw new HttpError(409, "MEDIA_STAGING_FILE_INVALID", "媒体断点暂存文件无效。");
  }
  return stat.size;
}

function normalizeManifestLimit(value) {
  if (value === undefined || value === "") return DEFAULT_MANIFEST_LIMIT;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1 || number > MAX_MANIFEST_LIMIT) {
    throw new HttpError(400, "MEDIA_MANIFEST_LIMIT_INVALID", "媒体清单页大小无效。");
  }
  return number;
}

function normalizeByteOffset(value, byteSize) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0 || number >= byteSize) {
    throw new HttpError(416, "MEDIA_RANGE_INVALID", "媒体分块起点无效。");
  }
  return number;
}

function normalizeUploadOffset(value, byteSize) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0 || number >= byteSize) {
    throw new HttpError(416, "MEDIA_RANGE_INVALID", "媒体上传分块起点无效。");
  }
  return number;
}

function normalizeChunkLength(value) {
  const number = Number(value ?? MEDIA_CHUNK_BYTES);
  if (!Number.isSafeInteger(number) || number < 1 || number > MEDIA_CHUNK_BYTES) {
    throw new HttpError(400, "MEDIA_CHUNK_LENGTH_INVALID", "媒体分块大小无效。");
  }
  return number;
}

function encodeCursor(cursor) {
  return Buffer.from(JSON.stringify([cursor.createdAt, cursor.id]), "utf8").toString("base64url");
}

function decodeCursor(value) {
  if (value === undefined || value === "") return { createdAt: 0, id: "" };
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      !Number.isSafeInteger(parsed[0]) ||
      parsed[0] < 0 ||
      typeof parsed[1] !== "string" ||
      parsed[1].length > 200
    ) throw new Error("invalid");
    return { createdAt: parsed[0], id: parsed[1] };
  } catch {
    throw new HttpError(400, "MEDIA_MANIFEST_CURSOR_INVALID", "媒体清单游标无效。");
  }
}

function safeChildPath(root, fileName, code) {
  if (!isSafeFileName(fileName)) {
    throw new HttpError(409, code, "媒体文件名无效。");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, fileName);
  if (path.dirname(resolved) !== resolvedRoot) {
    throw new HttpError(409, code, "媒体文件路径无效。");
  }
  return resolved;
}

function isSafeFileName(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 180 &&
    path.basename(value) === value &&
    value !== "." &&
    value !== ".."
  );
}

function isIdentifier(value) {
  return typeof value === "string" && value.length >= 1 && value.length <= 200;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function throwIfAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("媒体同步已取消。");
    error.code = "ABORT_ERR";
    throw error;
  }
}

module.exports = {
  DEFAULT_MANIFEST_LIMIT,
  IncrementalMediaReplicationService,
  MAX_MEDIA_BYTES,
  MEDIA_CHUNK_BYTES
};
