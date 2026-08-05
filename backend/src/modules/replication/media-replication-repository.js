class MediaReplicationRepository {
  constructor(database) {
    this.database = database;
  }

  find(spaceId, sourceNodeId, mediaId) {
    const row = this.database.prepare(
      `SELECT space_id, source_node_id, media_id, mime_type, file_name,
              byte_size, content_hash, media_created_at, temp_file_name,
              received_bytes, status, updated_at
       FROM replication_media_staging
       WHERE space_id = ? AND source_node_id = ? AND media_id = ?`
    ).get(spaceId, sourceNodeId, mediaId);
    return row ? present(row) : null;
  }

  create(input) {
    this.database.prepare(
      `INSERT INTO replication_media_staging(
         space_id, source_node_id, media_id, mime_type, file_name,
         byte_size, content_hash, media_created_at, temp_file_name,
         received_bytes, status, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'pending', ?)`
    ).run(
      input.spaceId,
      input.sourceNodeId,
      input.mediaId,
      input.mimeType,
      input.fileName,
      input.byteSize,
      input.contentHash,
      input.createdAt,
      input.tempFileName,
      input.updatedAt
    );
    return this.find(input.spaceId, input.sourceNodeId, input.mediaId);
  }

  updateProgress(spaceId, sourceNodeId, mediaId, receivedBytes, status, updatedAt) {
    this.database.prepare(
      `UPDATE replication_media_staging
       SET received_bytes = ?, status = ?, updated_at = ?
       WHERE space_id = ? AND source_node_id = ? AND media_id = ?`
    ).run(receivedBytes, status, updatedAt, spaceId, sourceNodeId, mediaId);
    return this.find(spaceId, sourceNodeId, mediaId);
  }

  delete(spaceId, sourceNodeId, mediaId) {
    this.database.prepare(
      `DELETE FROM replication_media_staging
       WHERE space_id = ? AND source_node_id = ? AND media_id = ?`
    ).run(spaceId, sourceNodeId, mediaId);
  }

  summary(spaceId, sourceNodeId) {
    const row = this.database.prepare(
      `SELECT COUNT(*) AS pending_count,
              COALESCE(SUM(byte_size - received_bytes), 0) AS pending_bytes,
              COALESCE(SUM(received_bytes), 0) AS received_bytes
       FROM replication_media_staging
       WHERE space_id = ? AND source_node_id = ?`
    ).get(spaceId, sourceNodeId);
    return {
      pendingCount: Number(row.pending_count),
      pendingBytes: Number(row.pending_bytes),
      receivedBytes: Number(row.received_bytes)
    };
  }
}

function present(row) {
  return {
    spaceId: row.space_id,
    sourceNodeId: row.source_node_id,
    mediaId: row.media_id,
    mimeType: row.mime_type,
    fileName: row.file_name,
    byteSize: Number(row.byte_size),
    contentHash: row.content_hash,
    createdAt: Number(row.media_created_at),
    tempFileName: row.temp_file_name,
    receivedBytes: Number(row.received_bytes),
    status: row.status,
    updatedAt: Number(row.updated_at)
  };
}

module.exports = { MediaReplicationRepository };
