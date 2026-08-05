class IntegrityRepository {
  constructor(database) {
    this.database = database;
  }

  transaction(action) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  currentSyncCursor(userId) {
    return Number(this.database.prepare(
      "SELECT COALESCE(MAX(seq), 0) AS cursor FROM sync_changes WHERE user_id = ?"
    ).get(userId).cursor);
  }

  saveSnapshot(snapshot) {
    this.database.prepare(
      `INSERT INTO replication_snapshots(
         id, space_id, source_node_id, requested_by_node_id, epoch,
         boundary_json, records_root, blobs_root, manifest_hash,
         manifest_json, status, created_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
    ).run(
      snapshot.id,
      snapshot.spaceId,
      snapshot.sourceNodeId,
      snapshot.requestedByNodeId,
      snapshot.epoch,
      JSON.stringify(snapshot.boundary),
      snapshot.recordsRoot,
      snapshot.blobsRoot,
      snapshot.manifestHash,
      JSON.stringify(snapshot.manifest),
      snapshot.status,
      snapshot.createdAt
    );
    const insertTable = this.database.prepare(
      `INSERT INTO replication_snapshot_tables(
         snapshot_id, table_name, row_count, table_root
       ) VALUES (?, ?, ?, ?)`
    );
    for (const table of snapshot.manifest.tables) {
      insertTable.run(snapshot.id, table.name, table.rowCount, table.root);
    }
    return this.findSnapshot(snapshot.id);
  }

  savePayload(input) {
    this.database.prepare(
      `INSERT INTO replication_snapshot_payloads(
         snapshot_id, space_id, encrypted_payload_json, payload_hash,
         byte_size, created_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      input.snapshotId,
      input.spaceId,
      JSON.stringify(input.envelope),
      input.payloadHash,
      input.byteSize,
      input.createdAt
    );
  }

  findPayload(snapshotId) {
    const row = this.database.prepare(
      `SELECT payload.snapshot_id, payload.space_id,
              payload.encrypted_payload_json, payload.payload_hash,
              payload.byte_size, payload.created_at,
              snapshot.requested_by_node_id, snapshot.source_node_id,
              snapshot.manifest_hash
       FROM replication_snapshot_payloads AS payload
       JOIN replication_snapshots AS snapshot ON snapshot.id = payload.snapshot_id
       WHERE payload.snapshot_id = ?`
    ).get(snapshotId);
    return row ? {
      snapshotId: row.snapshot_id,
      spaceId: row.space_id,
      sourceNodeId: row.source_node_id,
      requestedByNodeId: row.requested_by_node_id,
      manifestHash: row.manifest_hash,
      envelope: JSON.parse(row.encrypted_payload_json),
      payloadHash: row.payload_hash,
      byteSize: Number(row.byte_size),
      createdAt: Number(row.created_at)
    } : null;
  }

  listEntityVersions(spaceId) {
    return this.database.prepare(
      `SELECT entity_type, entity_id, version, updated_at
       FROM replication_entity_versions
       WHERE space_id = ? ORDER BY entity_type, entity_id`
    ).all(spaceId).map((row) => ({
      entityType: row.entity_type,
      entityId: row.entity_id,
      version: Number(row.version),
      updatedAt: Number(row.updated_at)
    }));
  }

  stagePayload(input) {
    const existing = this.findStaging(input.snapshotId);
    if (existing) return existing;
    this.database.prepare(
      `INSERT INTO replication_bootstrap_staging(
         snapshot_id, space_id, source_node_id, manifest_hash,
         records_root, blobs_root, boundary_json, encrypted_payload_json,
         payload_hash, status, created_at, verified_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.snapshotId,
      input.spaceId,
      input.sourceNodeId,
      input.manifestHash,
      input.recordsRoot,
      input.blobsRoot,
      JSON.stringify(input.boundary),
      JSON.stringify(input.envelope),
      input.payloadHash,
      input.status,
      input.createdAt,
      input.verifiedAt
    );
    return this.findStaging(input.snapshotId);
  }

  initializeBlobStaging(snapshotId, blobs, updatedAt) {
    const insert = this.database.prepare(
      `INSERT INTO replication_blob_staging(
         snapshot_id, media_id, content_hash, byte_size, received_bytes,
         temp_file_name, status, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    for (const blob of blobs) {
      insert.run(
        snapshotId,
        blob.mediaId,
        blob.contentHash,
        blob.byteSize,
        blob.receivedBytes || 0,
        blob.tempFileName,
        blob.status,
        updatedAt
      );
    }
  }

  findBlobStaging(snapshotId, mediaId) {
    const row = this.database.prepare(
      `SELECT snapshot_id, media_id, content_hash, byte_size, received_bytes,
              temp_file_name, status, updated_at
       FROM replication_blob_staging
       WHERE snapshot_id = ? AND media_id = ?`
    ).get(snapshotId, mediaId);
    return row ? presentBlobStaging(row) : null;
  }

  listBlobStaging(snapshotId) {
    return this.database.prepare(
      `SELECT snapshot_id, media_id, content_hash, byte_size, received_bytes,
              temp_file_name, status, updated_at
       FROM replication_blob_staging
       WHERE snapshot_id = ? ORDER BY media_id`
    ).all(snapshotId).map(presentBlobStaging);
  }

  updateBlobProgress(snapshotId, mediaId, receivedBytes, status, updatedAt) {
    this.database.prepare(
      `UPDATE replication_blob_staging
       SET received_bytes = ?, status = ?, updated_at = ?
       WHERE snapshot_id = ? AND media_id = ?`
    ).run(receivedBytes, status, updatedAt, snapshotId, mediaId);
    return this.findBlobStaging(snapshotId, mediaId);
  }

  countUnverifiedBlobs(snapshotId) {
    return Number(this.database.prepare(
      `SELECT COUNT(*) AS count FROM replication_blob_staging
       WHERE snapshot_id = ? AND status != 'verified'`
    ).get(snapshotId).count);
  }

  findStaging(snapshotId) {
    const row = this.database.prepare(
      `SELECT snapshot_id, space_id, source_node_id, manifest_hash,
              records_root, blobs_root, boundary_json, payload_hash,
              status, created_at, verified_at
       FROM replication_bootstrap_staging WHERE snapshot_id = ?`
    ).get(snapshotId);
    return row ? {
      snapshotId: row.snapshot_id,
      spaceId: row.space_id,
      sourceNodeId: row.source_node_id,
      manifestHash: row.manifest_hash,
      recordsRoot: row.records_root,
      blobsRoot: row.blobs_root,
      boundary: JSON.parse(row.boundary_json),
      payloadHash: row.payload_hash,
      status: row.status,
      createdAt: Number(row.created_at),
      verifiedAt: row.verified_at === null ? null : Number(row.verified_at)
    } : null;
  }

  loadStagingPayload(snapshotId) {
    const row = this.database.prepare(
      `SELECT encrypted_payload_json
       FROM replication_bootstrap_staging WHERE snapshot_id = ?`
    ).get(snapshotId);
    return row ? JSON.parse(row.encrypted_payload_json) : null;
  }

  replicationStateCount(spaceId) {
    const row = this.database.prepare(
      `SELECT
         (SELECT COUNT(*) FROM replication_operations WHERE space_id = ?) +
         (SELECT COUNT(*) FROM replication_entity_versions WHERE space_id = ?) +
         (SELECT COUNT(*) FROM applied_operations WHERE space_id = ?) AS count`
    ).get(spaceId, spaceId, spaceId);
    return Number(row.count);
  }

  updateStagingStatus(snapshotId, status, verifiedAt) {
    this.database.prepare(
      `UPDATE replication_bootstrap_staging
       SET status = ?, verified_at = ? WHERE snapshot_id = ?`
    ).run(status, verifiedAt, snapshotId);
    return this.findStaging(snapshotId);
  }

  completeSnapshot(snapshotId, completedAt) {
    this.database.prepare(
      `UPDATE replication_snapshots
       SET status = 'completed', completed_at = ? WHERE id = ?`
    ).run(completedAt, snapshotId);
    return this.findSnapshot(snapshotId);
  }

  deleteUnfinishedSnapshotsForNode(spaceId, nodeId, exceptSnapshotId) {
    return this.database.prepare(
      `DELETE FROM replication_snapshots
       WHERE space_id = ? AND requested_by_node_id = ? AND id != ?
         AND status IN ('payload_ready', 'standby_pending')`
    ).run(spaceId, nodeId, exceptSnapshotId).changes;
  }

  updateSnapshotStatus(snapshotId, status) {
    this.database.prepare(
      "UPDATE replication_snapshots SET status = ? WHERE id = ?"
    ).run(status, snapshotId);
    return this.findSnapshot(snapshotId);
  }

  findSnapshot(id) {
    const row = this.database.prepare(
      `SELECT id, space_id, source_node_id, requested_by_node_id, epoch,
              boundary_json, records_root, blobs_root, manifest_hash,
              manifest_json, status, created_at, completed_at
       FROM replication_snapshots WHERE id = ?`
    ).get(id);
    return row ? presentSnapshot(row) : null;
  }
}

function presentBlobStaging(row) {
  return {
    snapshotId: row.snapshot_id,
    mediaId: row.media_id,
    contentHash: row.content_hash,
    byteSize: Number(row.byte_size),
    receivedBytes: Number(row.received_bytes),
    tempFileName: row.temp_file_name,
    status: row.status,
    updatedAt: Number(row.updated_at)
  };
}

function presentSnapshot(row) {
  return {
    id: row.id,
    spaceId: row.space_id,
    sourceNodeId: row.source_node_id,
    requestedByNodeId: row.requested_by_node_id,
    epoch: Number(row.epoch),
    boundary: JSON.parse(row.boundary_json),
    recordsRoot: row.records_root,
    blobsRoot: row.blobs_root,
    manifestHash: row.manifest_hash,
    manifest: JSON.parse(row.manifest_json),
    status: row.status,
    createdAt: Number(row.created_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at)
  };
}

module.exports = { IntegrityRepository };
