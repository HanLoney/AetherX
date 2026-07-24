const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { supportsFts5 } = require("../../infrastructure/database");
const { decryptArchive, encryptPayload } = require("./archive-crypto");
const {
  CURRENT_USER,
  DIGEST_ALGORITHM,
  FORMAT_VERSION,
  INSERT_ORDER,
  MAX_ARCHIVE_BYTES,
  TABLES,
  archiveError,
  continuityDigest,
  encodeMetadata,
  normalizeRow,
  readMetadata,
  validateMetadata
} = require("./archive-format");

const PASSWORD_MIN_LENGTH = 8;
const DOWNLOAD_TTL_MS = 5 * 60_000;

class ArchiveService {
  constructor({ database, secretBox, dataDir, isAgentBusy = () => false }) {
    this.database = database;
    this.secretBox = secretBox;
    this.dataDir = dataDir;
    this.mediaDir = path.join(dataDir, "media");
    this.tempDir = path.join(dataDir, "archive-tmp");
    this.backupDir = path.join(dataDir, "archive-backups");
    this.isAgentBusy = isAgentBusy;
    this.busyUsers = new Set();
    this.downloads = new Map();
    fs.mkdirSync(this.mediaDir, { recursive: true });
    fs.mkdirSync(this.tempDir, { recursive: true });
    fs.mkdirSync(this.backupDir, { recursive: true });
  }

  async createDownload(userId, password) {
    return this.withUserLock(userId, async () => {
      this.requirePassword(password);
      this.requireAgentIdle(userId);
      this.discardUserDownloads(userId);
      const result = await this.createArchive(userId, password, this.tempDir, "完整存档");
      const ticket = crypto.randomUUID();
      const expiresAt = Date.now() + DOWNLOAD_TTL_MS;
      this.downloads.set(ticket, { ...result, userId, expiresAt });
      const cleanupTimer = setTimeout(() => this.pruneDownloads(), DOWNLOAD_TTL_MS + 1000);
      cleanupTimer.unref?.();
      this.pruneDownloads();
      return {
        ticket,
        fileName: result.fileName,
        expiresAt,
        summary: presentManifest(result.metadata)
      };
    });
  }

  isUserLocked(userId) {
    return this.busyUsers.has(userId);
  }

  takeDownload(ticket) {
    this.pruneDownloads();
    const entry = this.downloads.get(String(ticket || ""));
    if (!entry || entry.expiresAt <= Date.now() || !fs.existsSync(entry.filePath)) {
      throw archiveError(404, "ARCHIVE_DOWNLOAD_EXPIRED", "这个存档下载链接已经失效，请重新导出。");
    }
    this.downloads.delete(ticket);
    return entry;
  }

  releaseDownload(entry) {
    if (entry?.filePath) fs.rmSync(entry.filePath, { force: true });
  }

  async restoreRequest(userId, request, password) {
    return this.withUserLock(userId, async () => {
      this.requirePassword(password);
      this.requireAgentIdle(userId);
      const inputPath = this.tempPath("upload", ".aetherx");
      const payloadPath = this.tempPath("payload", ".bin");
      const stageDir = this.tempPath("stage", "");
      fs.mkdirSync(stageDir, { recursive: false });
      try {
        await receiveRequest(request, inputPath);
        await decryptArchive(inputPath, payloadPath, password);
        const parsed = readMetadata(payloadPath, fs);
        const metadata = validateMetadata(parsed.metadata);
        this.validateRecordShape(metadata.records);
        const stagedMedia = await this.stageMedia(payloadPath, parsed.mediaOffset, metadata, stageDir);
        this.validateConflicts(userId, metadata.records);
        const backup = await this.createArchive(userId, password, this.backupDir, "恢复前自动备份");
        const result = this.replaceUserData(userId, metadata, stagedMedia);
        return {
          ...result,
          backupFileName: backup.fileName,
          restored: presentManifest(metadata)
        };
      } finally {
        fs.rmSync(inputPath, { force: true });
        fs.rmSync(payloadPath, { force: true });
        fs.rmSync(stageDir, { recursive: true, force: true });
      }
    });
  }

  async createArchive(userId, password, outputDir, label) {
    const snapshot = await this.collectSnapshot(userId);
    const now = Date.now();
    const metadata = {
      format: "AetherX Full Archive",
      formatVersion: FORMAT_VERSION,
      digestAlgorithm: DIGEST_ALGORITHM,
      archiveMode: "full_restore_only",
      createdAt: now,
      label,
      account: snapshot.account,
      credentials: snapshot.credentials,
      records: snapshot.records,
      media: snapshot.media.map(({ filePath: _filePath, ...item }) => item),
      recordCounts: Object.fromEntries(TABLES.map((table) => [table, snapshot.records[table].length])),
      totalMediaBytes: snapshot.media.reduce((sum, item) => sum + item.byteSize, 0)
    };
    metadata.continuityDigest = continuityDigest(metadata);
    const safeStamp = new Date(now).toISOString().replace(/[:.]/g, "-");
    const fileName = `AetherX-${safeStamp}-${crypto.randomUUID().slice(0, 8)}.aetherx`;
    const filePath = path.join(outputDir, fileName);
    const encoded = encodeMetadata(metadata);
    const source = Readable.from(payloadChunks(encoded, snapshot.media));
    try {
      await encryptPayload(source, filePath, password);
      return { filePath, fileName, metadata };
    } catch (error) {
      fs.rmSync(filePath, { force: true });
      throw error;
    }
  }

  async collectSnapshot(userId) {
    const records = this.collectRecords(userId);
    const accountRow = this.database.prepare("SELECT display_name FROM users WHERE id = ?").get(userId);
    const credentials = {
      aiApiKey: decryptSecret(this.secretBox, records.ai_configs[0]?.encrypted_api_key),
      imageApiKey: decryptSecret(this.secretBox, records.ai_image_configs[0]?.encrypted_api_key)
    };
    records.ai_configs = records.ai_configs.map((row) => normalizeRow(row));
    records.ai_image_configs = records.ai_image_configs.map((row) => normalizeRow(row));
    const media = [];
    for (const row of records.media_assets) {
      const filePath = safeMediaPath(this.mediaDir, row.file_name);
      if (!fs.existsSync(filePath)) {
        throw archiveError(409, "ARCHIVE_MEDIA_MISSING", `媒体文件 ${row.id} 不存在，无法生成完整存档。`);
      }
      const stat = fs.statSync(filePath);
      if (stat.size !== Number(row.byte_size)) {
        throw archiveError(409, "ARCHIVE_MEDIA_SIZE_MISMATCH", `媒体文件 ${row.id} 的大小与记录不一致。`);
      }
      const contentHash = await hashFile(filePath);
      if (contentHash !== row.content_hash) {
        throw archiveError(409, "ARCHIVE_MEDIA_HASH_MISMATCH", `媒体文件 ${row.id} 已损坏。`);
      }
      media.push({
        id: row.id,
        mimeType: row.mime_type,
        fileName: row.file_name,
        byteSize: Number(row.byte_size),
        contentHash,
        filePath
      });
    }
    records.media_assets = records.media_assets.map((row) => normalizeRow(row));
    for (const table of TABLES) {
      records[table] = records[table].map((row) => normalizeRow(row));
    }
    return {
      account: { displayName: String(accountRow?.display_name || "") },
      credentials,
      records,
      media
    };
  }

  collectRecords(userId) {
    const records = {};
    for (const table of TABLES) {
      if (table === "messages") {
        records[table] = this.database.prepare(
          `SELECT m.* FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE c.user_id = ? ORDER BY m.conversation_id, m.stream_type, m.position, m.created_at, m.id`
        ).all(userId);
      } else {
        records[table] = this.database.prepare(
          `SELECT * FROM "${table}" WHERE user_id = ? ORDER BY rowid`
        ).all(userId);
      }
    }
    return records;
  }

  async stageMedia(payloadPath, mediaOffset, metadata, stageDir) {
    const stat = fs.statSync(payloadPath);
    let cursor = mediaOffset;
    const staged = [];
    const mediaRows = new Map(metadata.records.media_assets.map((row) => [row.id, row]));
    if (mediaRows.size !== metadata.media.length) throw invalidMediaList();
    for (const item of metadata.media) {
      const row = mediaRows.get(item.id);
      if (!row || row.file_name !== item.fileName || Number(row.byte_size) !== item.byteSize ||
          row.content_hash !== item.contentHash || row.mime_type !== item.mimeType) {
        throw invalidMediaList();
      }
      const end = cursor + item.byteSize;
      if (end > stat.size) throw invalidMediaList();
      const targetPath = path.join(stageDir, item.fileName);
      const hash = crypto.createHash("sha256");
      const verifier = new Transform({
        transform(chunk, _encoding, callback) {
          hash.update(chunk);
          callback(null, chunk);
        }
      });
      if (item.byteSize === 0) {
        fs.writeFileSync(targetPath, Buffer.alloc(0), { flag: "wx" });
      } else {
        await pipeline(
          fs.createReadStream(payloadPath, { start: cursor, end: end - 1 }),
          verifier,
          fs.createWriteStream(targetPath, { flags: "wx", mode: 0o600 })
        );
      }
      const actualHash = item.byteSize === 0
        ? crypto.createHash("sha256").update(Buffer.alloc(0)).digest("hex")
        : hash.digest("hex");
      if (actualHash !== item.contentHash) {
        throw archiveError(400, "ARCHIVE_MEDIA_HASH_MISMATCH", `存档中的媒体文件 ${item.id} 校验失败。`);
      }
      staged.push({ ...item, stagePath: targetPath });
      cursor = end;
    }
    if (cursor !== stat.size) throw invalidMediaList();
    return staged;
  }

  replaceUserData(userId, metadata, stagedMedia) {
    const existingMedia = this.database.prepare(
      `SELECT file_name, preview_file_name FROM media_assets WHERE user_id = ?`
    ).all(userId);
    const currentNames = new Set(existingMedia.flatMap((row) =>
      [row.file_name, row.preview_file_name].filter(Boolean)));
    for (const item of stagedMedia) {
      const finalPath = safeMediaPath(this.mediaDir, item.fileName);
      if (fs.existsSync(finalPath) && !currentNames.has(item.fileName)) {
        throw archiveError(409, "ARCHIVE_MEDIA_FILE_CONFLICT", `媒体文件名 ${item.fileName} 已被占用。`);
      }
    }

    const rollbackDir = this.tempPath("rollback", "");
    fs.mkdirSync(rollbackDir, { recursive: false });
    const movedOld = [];
    const movedNew = [];
    let transaction = false;
    try {
      this.database.exec("BEGIN IMMEDIATE");
      transaction = true;
      for (const name of currentNames) {
        const source = safeMediaPath(this.mediaDir, name);
        if (!fs.existsSync(source)) continue;
        const target = path.join(rollbackDir, name);
        fs.renameSync(source, target);
        movedOld.push({ source, target });
      }
      for (const item of stagedMedia) {
        const finalPath = safeMediaPath(this.mediaDir, item.fileName);
        fs.renameSync(item.stagePath, finalPath);
        movedNew.push(finalPath);
      }

      this.deleteUserData(userId);
      this.insertUserData(userId, metadata.records, metadata.credentials);
      this.database.prepare("UPDATE users SET display_name = ?, updated_at = ? WHERE id = ?")
        .run(String(metadata.account?.displayName || ""), Date.now(), userId);
      this.rebuildMemoryIndex(userId);
      const resetCursor = Number(this.database.prepare(
        `INSERT INTO sync_changes(user_id, entity_type, entity_id, operation, created_at)
         VALUES (?, 'archive_restore', ?, 'reset', ?)`
      ).run(userId, crypto.randomUUID(), Date.now()).lastInsertRowid);

      const restoredRecords = this.collectRecords(userId);
      const restoredCredentials = {
        aiApiKey: decryptSecret(this.secretBox, restoredRecords.ai_configs[0]?.encrypted_api_key),
        imageApiKey: decryptSecret(this.secretBox, restoredRecords.ai_image_configs[0]?.encrypted_api_key)
      };
      const restoredDigest = continuityDigest({
        account: { displayName: String(metadata.account?.displayName || "") },
        credentials: restoredCredentials,
        records: restoredRecords,
        media: metadata.media
      });
      if (restoredDigest !== metadata.continuityDigest) {
        throw archiveError(500, "ARCHIVE_RESTORE_DIGEST_MISMATCH", "恢复后的数据与存档不一致，已自动回滚。");
      }
      this.database.exec("COMMIT");
      transaction = false;
      fs.rmSync(rollbackDir, { recursive: true, force: true });
      return { continuityDigest: restoredDigest, resetRequired: true, resetCursor };
    } catch (error) {
      if (transaction) {
        try { this.database.exec("ROLLBACK"); } catch {}
      }
      for (const filePath of movedNew.reverse()) fs.rmSync(filePath, { force: true });
      for (const item of movedOld.reverse()) {
        if (fs.existsSync(item.target)) fs.renameSync(item.target, item.source);
      }
      fs.rmSync(rollbackDir, { recursive: true, force: true });
      throw error;
    }
  }

  deleteUserData(userId) {
    const conversationIds = this.database.prepare(
      "SELECT id FROM conversations WHERE user_id = ?"
    ).all(userId).map((row) => row.id);
    const deleteMessages = this.database.prepare("DELETE FROM messages WHERE conversation_id = ?");
    for (const id of conversationIds) deleteMessages.run(id);
    for (const table of [...INSERT_ORDER].reverse()) {
      if (table === "messages") continue;
      this.database.prepare(`DELETE FROM "${table}" WHERE user_id = ?`).run(userId);
    }
  }

  insertUserData(userId, records, credentials) {
    for (const table of INSERT_ORDER) {
      for (const archivedRow of records[table]) {
        const row = { ...archivedRow };
        if (Object.hasOwn(row, "user_id")) row.user_id = userId;
        if (table === "ai_configs") row.encrypted_api_key = this.secretBox.encrypt(credentials?.aiApiKey || "");
        if (table === "ai_image_configs") row.encrypted_api_key = this.secretBox.encrypt(credentials?.imageApiKey || "");
        if (table === "media_assets") {
          row.preview_file_name = "";
          row.preview_byte_size = 0;
        }
        const columns = Object.keys(row);
        const placeholders = columns.map(() => "?").join(", ");
        this.database.prepare(
          `INSERT INTO "${table}" (${columns.map((column) => `"${column}"`).join(", ")}) VALUES (${placeholders})`
        ).run(...columns.map((column) => row[column]));
      }
    }
  }

  rebuildMemoryIndex(userId) {
    if (!supportsFts5(this.database)) return;
    this.database.prepare("DELETE FROM memories_fts WHERE user_id = ?").run(userId);
    const insert = this.database.prepare(
      "INSERT INTO memories_fts(memory_id, user_id, content, entities) VALUES (?, ?, ?, ?)"
    );
    for (const row of this.database.prepare(
      "SELECT id, content, entities_json FROM memories WHERE user_id = ?"
    ).all(userId)) {
      let entities = "";
      try { entities = JSON.parse(row.entities_json || "[]").join(" "); } catch {}
      insert.run(row.id, userId, row.content, entities);
    }
  }

  validateRecordShape(records) {
    for (const table of TABLES) {
      const columns = this.database.prepare(`PRAGMA table_info("${table}")`).all().map((row) => row.name);
      const expected = [...columns].sort().join("\0");
      for (const row of records[table]) {
        if (!row || typeof row !== "object" || Array.isArray(row)) throw invalidRecordSet();
        if (Object.hasOwn(row, "user_id") && row.user_id !== CURRENT_USER) throw invalidRecordSet();
        if (Object.keys(row).sort().join("\0") !== expected) throw invalidRecordSet();
      }
    }
  }

  validateConflicts(userId, records) {
    for (const table of TABLES) {
      if (table === "messages") continue;
      const columns = this.database.prepare(`PRAGMA table_info("${table}")`).all();
      if (!columns.some((column) => column.name === "id" && column.pk)) continue;
      const statement = this.database.prepare(`SELECT user_id FROM "${table}" WHERE id = ?`);
      for (const row of records[table]) {
        const existing = statement.get(row.id);
        if (existing && existing.user_id !== userId) throw archiveConflict(table, row.id);
      }
    }
    const messageOwner = this.database.prepare(
      `SELECT c.user_id FROM messages m JOIN conversations c ON c.id = m.conversation_id WHERE m.id = ?`
    );
    for (const row of records.messages) {
      const existing = messageOwner.get(row.id);
      if (existing && existing.user_id !== userId) throw archiveConflict("messages", row.id);
    }
    const fileOwner = this.database.prepare("SELECT user_id FROM media_assets WHERE file_name = ?");
    for (const row of records.media_assets) {
      const existing = fileOwner.get(row.file_name);
      if (existing && existing.user_id !== userId) throw archiveConflict("media_assets", row.id);
    }
  }

  requirePassword(password) {
    if (typeof password !== "string" || password.length < PASSWORD_MIN_LENGTH || password.length > 256) {
      throw archiveError(400, "ARCHIVE_PASSWORD_INVALID", `存档密码至少需要 ${PASSWORD_MIN_LENGTH} 个字符。`);
    }
  }

  requireAgentIdle(userId) {
    if (this.isAgentBusy(userId)) {
      throw archiveError(409, "ARCHIVE_AGENT_BUSY", "AI 正在回复或等待批准，请结束本次任务后再操作存档。");
    }
  }

  async withUserLock(userId, action) {
    if (this.busyUsers.has(userId)) {
      throw archiveError(409, "ARCHIVE_OPERATION_BUSY", "当前账号已经有一个存档任务正在进行。");
    }
    this.busyUsers.add(userId);
    try {
      return await action();
    } finally {
      this.busyUsers.delete(userId);
    }
  }

  tempPath(prefix, extension) {
    return path.join(this.tempDir, `${prefix}-${crypto.randomUUID()}${extension}`);
  }

  pruneDownloads() {
    const now = Date.now();
    for (const [ticket, entry] of this.downloads) {
      if (entry.expiresAt > now && fs.existsSync(entry.filePath)) continue;
      this.downloads.delete(ticket);
      fs.rmSync(entry.filePath, { force: true });
    }
  }

  discardUserDownloads(userId) {
    this.pruneDownloads();
    for (const [ticket, entry] of this.downloads) {
      if (entry.userId !== userId) continue;
      this.downloads.delete(ticket);
      fs.rmSync(entry.filePath, { force: true });
    }
  }
}

async function* payloadChunks(encoded, media) {
  yield encoded.length;
  yield encoded.bytes;
  for (const item of media) {
    for await (const chunk of fs.createReadStream(item.filePath)) yield chunk;
  }
}

async function receiveRequest(request, outputPath) {
  let size = 0;
  const limiter = new Transform({
    transform(chunk, _encoding, callback) {
      size += chunk.length;
      if (size > MAX_ARCHIVE_BYTES) {
        callback(archiveError(413, "ARCHIVE_TOO_LARGE", "上传的存档文件过大。"));
      } else callback(null, chunk);
    }
  });
  try {
    await pipeline(request, limiter, fs.createWriteStream(outputPath, { flags: "wx", mode: 0o600 }));
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    throw error;
  }
  if (!size) throw archiveError(400, "ARCHIVE_FILE_REQUIRED", "请选择要恢复的 AetherX 存档文件。");
}

async function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function safeMediaPath(mediaDir, fileName) {
  const result = path.resolve(mediaDir, String(fileName || ""));
  if (path.dirname(result) !== path.resolve(mediaDir)) throw invalidMediaList();
  return result;
}

function decryptSecret(secretBox, encrypted) {
  if (!encrypted) return "";
  try {
    return secretBox.decrypt(encrypted);
  } catch {
    throw archiveError(409, "ARCHIVE_SECRET_UNREADABLE", "Hub 无法读取当前保存的 API Key，存档未生成。");
  }
}

function presentManifest(metadata) {
  return {
    formatVersion: metadata.formatVersion,
    digestAlgorithm: metadata.digestAlgorithm,
    createdAt: metadata.createdAt,
    recordCounts: metadata.recordCounts,
    totalMediaBytes: metadata.totalMediaBytes,
    continuityDigest: metadata.continuityDigest,
    archiveMode: "full_restore_only"
  };
}

function invalidRecordSet() {
  return archiveError(400, "ARCHIVE_RECORDS_INVALID", "存档的数据结构与当前 AetherX 版本不兼容。");
}

function invalidMediaList() {
  return archiveError(400, "ARCHIVE_MEDIA_INVALID", "存档中的媒体清单无效或不完整。");
}

function archiveConflict(table, id) {
  return archiveError(409, "ARCHIVE_ID_CONFLICT", `存档记录 ${table}/${id} 已属于 Hub 中的其他账号。`);
}

module.exports = { ArchiveService, PASSWORD_MIN_LENGTH };
