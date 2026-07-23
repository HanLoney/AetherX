const { randomUUID } = require("node:crypto");

class MediaRepository {
  constructor(database) {
    this.database = database;
  }

  findByHash(userId, contentHash) {
    return mapAsset(
      this.database
        .prepare(
          `SELECT id, user_id, mime_type, file_name, byte_size, content_hash,
                  preview_file_name, preview_byte_size, created_at
           FROM media_assets WHERE user_id = ? AND content_hash = ?`
        )
        .get(userId, contentHash)
    );
  }

  find(userId, id) {
    return mapAsset(
      this.database
        .prepare(
          `SELECT id, user_id, mime_type, file_name, byte_size, content_hash,
                  preview_file_name, preview_byte_size, created_at
           FROM media_assets WHERE user_id = ? AND id = ?`
        )
        .get(userId, id)
    );
  }

  create(userId, input) {
    const id = randomUUID();
    const createdAt = Date.now();
    this.database
      .prepare(
        `INSERT INTO media_assets(
          id, user_id, mime_type, file_name, byte_size, content_hash, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        input.mimeType,
        input.fileName,
        input.byteSize,
        input.contentHash,
        createdAt
      );
    return this.find(userId, id);
  }

  legacyConversationImages() {
    return this.database
      .prepare(
        `SELECT m.id, m.payload_json, c.user_id
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE m.stream_type = 'display'
           AND instr(m.payload_json, 'data:image/') > 0`
      )
      .all();
  }

  updateMessagePayload(id, payload) {
    this.database
      .prepare("UPDATE messages SET payload_json = ? WHERE id = ?")
      .run(JSON.stringify(payload), id);
  }

  savePreview(id, fileName, byteSize) {
    this.database
      .prepare(
        `UPDATE media_assets
         SET preview_file_name = ?, preview_byte_size = ?
         WHERE id = ?`
      )
      .run(fileName, byteSize, id);
  }
}

function mapAsset(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    mimeType: row.mime_type,
    fileName: row.file_name,
    byteSize: row.byte_size,
    contentHash: row.content_hash,
    previewFileName: row.preview_file_name || "",
    previewByteSize: row.preview_byte_size || 0,
    createdAt: row.created_at
  };
}

module.exports = { MediaRepository };
