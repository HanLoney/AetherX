const { mapOperation } = require("../replication/replication-repository");

class ForcedTakeoverRepository {
  constructor(database) {
    this.database = database;
  }

  save(input) {
    this.database.prepare(
      `INSERT INTO hub_forced_takeovers(
         id, space_id, previous_active_node_id, active_node_id,
         previous_epoch, epoch, proof_json, proof_hash, control_signature,
         integrity_json, status, detected_at, reconciled_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT(id) DO NOTHING`
    ).run(
      input.id,
      input.spaceId,
      input.previousActiveNodeId,
      input.activeNodeId,
      input.previousEpoch,
      input.epoch,
      input.proofJson,
      input.proofHash,
      input.controlSignature,
      input.integrityJson,
      input.status,
      input.detectedAt
    );
    return this.find(input.spaceId, input.id);
  }

  quarantineLocalOperations(input) {
    return this.database.prepare(
      `INSERT OR IGNORE INTO hub_divergent_operations(
         space_id, takeover_id, operation_id, origin_node_id,
         origin_sequence, epoch, entity_type, entity_id,
         operation_hash, status, quarantined_at
       )
       SELECT space_id, ?, operation_id, origin_node_id,
              origin_sequence, epoch, entity_type, entity_id,
              operation_hash, 'quarantined', ?
       FROM replication_operations
       WHERE space_id = ? AND origin_node_id = ?
         AND origin_sequence > ? AND epoch <= ?`
    ).run(
      input.takeoverId,
      input.quarantinedAt,
      input.spaceId,
      input.originNodeId,
      input.afterSequence,
      input.maximumEpoch
    ).changes;
  }

  find(spaceId, id) {
    return this.database.prepare(
      `SELECT * FROM hub_forced_takeovers WHERE space_id = ? AND id = ?`
    ).get(spaceId, id);
  }

  latest(spaceId) {
    return this.database.prepare(
      `SELECT * FROM hub_forced_takeovers
       WHERE space_id = ? ORDER BY detected_at DESC, id DESC LIMIT 1`
    ).get(spaceId);
  }

  divergentCount(spaceId, takeoverId) {
    const live = Number(this.database.prepare(
      `SELECT COUNT(*) AS count FROM hub_divergent_operations
       WHERE space_id = ? AND takeover_id = ? AND status = 'quarantined'`
    ).get(spaceId, takeoverId)?.count || 0);
    const archived = Number(this.database.prepare(
      `SELECT COUNT(*) AS count FROM hub_divergent_operation_archive
       WHERE space_id = ? AND takeover_id = ?`
    ).get(spaceId, takeoverId)?.count || 0);
    return live + archived;
  }

  listDivergentOperations(spaceId, takeoverId, options = {}) {
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    const offset = Math.max(0, Number(options.offset) || 0);
    return this.database.prepare(
      `SELECT operation.*, divergent.status AS divergence_status,
              divergent.quarantined_at
       FROM hub_divergent_operations AS divergent
       JOIN replication_operations AS operation
         ON operation.operation_id = divergent.operation_id
       WHERE divergent.space_id = ? AND divergent.takeover_id = ?
       ORDER BY divergent.origin_node_id, divergent.origin_sequence
       LIMIT ? OFFSET ?`
    ).all(spaceId, takeoverId, limit, offset).map((row) => ({
      ...mapOperation(row),
      divergenceStatus: row.divergence_status,
      quarantinedAt: Number(row.quarantined_at)
    }));
  }

  listAllDivergentOperations(spaceId, takeoverId) {
    const live = this.database.prepare(
      `SELECT operation.*, divergent.status AS divergence_status,
              divergent.quarantined_at
       FROM hub_divergent_operations AS divergent
       JOIN replication_operations AS operation
         ON operation.operation_id = divergent.operation_id
       WHERE divergent.space_id = ? AND divergent.takeover_id = ?
       ORDER BY divergent.origin_node_id, divergent.origin_sequence`
    ).all(spaceId, takeoverId).map((row) => ({
      ...mapOperation(row),
      divergenceStatus: row.divergence_status,
      quarantinedAt: Number(row.quarantined_at)
    }));
    if (live.length) return live;
    return this.database.prepare(
      `SELECT operation_json, resolution, archived_at
       FROM hub_divergent_operation_archive
       WHERE space_id = ? AND takeover_id = ?
       ORDER BY operation_id`
    ).all(spaceId, takeoverId).map((row) => ({
      ...JSON.parse(row.operation_json),
      divergenceStatus: row.resolution,
      quarantinedAt: Number(row.archived_at)
    }));
  }

  archiveDivergentOperations(spaceId, takeoverId, resolution, archivedAt) {
    const operations = this.listAllDivergentOperations(spaceId, takeoverId);
    const insert = this.database.prepare(
      `INSERT OR IGNORE INTO hub_divergent_operation_archive(
         space_id, takeover_id, operation_id, operation_json, resolution, archived_at
       ) VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const operation of operations) {
      insert.run(
        spaceId,
        takeoverId,
        operation.operationId,
        JSON.stringify(operation),
        resolution,
        archivedAt
      );
    }
    this.database.prepare(
      `DELETE FROM hub_divergent_operations WHERE space_id = ? AND takeover_id = ?`
    ).run(spaceId, takeoverId);
    return operations.length;
  }

  createRecovery(input) {
    this.database.prepare(
      `INSERT INTO hub_divergence_recoveries(
         id, space_id, takeover_id, authority_node_id, target_node_id,
         source_epoch, target_epoch, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.spaceId,
      input.takeoverId,
      input.authorityNodeId,
      input.targetNodeId,
      input.sourceEpoch,
      input.targetEpoch,
      input.status,
      input.createdAt,
      input.createdAt
    );
    return this.findRecovery(input.id);
  }

  findRecovery(id) {
    return this.database.prepare(
      "SELECT * FROM hub_divergence_recoveries WHERE id = ?"
    ).get(id);
  }

  latestRecovery(spaceId) {
    return this.database.prepare(
      `SELECT * FROM hub_divergence_recoveries
       WHERE space_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`
    ).get(spaceId);
  }

  activeRecovery(spaceId) {
    return this.database.prepare(
      `SELECT * FROM hub_divergence_recoveries
       WHERE space_id = ? AND status NOT IN ('completed', 'failed', 'cancelled')
       ORDER BY created_at DESC, id DESC LIMIT 1`
    ).get(spaceId);
  }

  saveRecoverySnapshot(id, input) {
    this.database.prepare(
      `UPDATE hub_divergence_recoveries
       SET encrypted_snapshot_json = ?, payload_hash = ?, snapshot_hash = ?,
           control_json = ?, control_signature = ?, status = ?, updated_at = ?,
           error_code = '', error_message = ''
       WHERE id = ?`
    ).run(
      input.encryptedSnapshotJson,
      input.payloadHash,
      input.snapshotHash,
      input.controlJson,
      input.controlSignature,
      input.status,
      input.updatedAt,
      id
    );
    return this.findRecovery(id);
  }

  updateRecoveryStatus(id, status, updatedAt, error = null) {
    this.database.prepare(
      `UPDATE hub_divergence_recoveries
       SET status = ?, updated_at = ?, error_code = ?, error_message = ?,
           completed_at = CASE WHEN ? = 'completed' THEN ? ELSE completed_at END
       WHERE id = ?`
    ).run(
      status,
      updatedAt,
      String(error?.code || ""),
      String(error?.message || ""),
      status,
      updatedAt,
      id
    );
    return this.findRecovery(id);
  }

  saveRecoveryChunk(recoveryId, offset, bytes, chunkHash, createdAt) {
    this.database.prepare(
      `INSERT OR IGNORE INTO hub_divergence_recovery_chunks(
         recovery_id, byte_offset, chunk_data, chunk_hash, created_at
       ) VALUES (?, ?, ?, ?, ?)`
    ).run(recoveryId, offset, bytes, chunkHash, createdAt);
  }

  recoveryChunks(recoveryId) {
    return this.database.prepare(
      `SELECT byte_offset, chunk_data, chunk_hash
       FROM hub_divergence_recovery_chunks
       WHERE recovery_id = ? ORDER BY byte_offset`
    ).all(recoveryId);
  }

  clearRecoveryChunks(recoveryId) {
    this.database.prepare(
      "DELETE FROM hub_divergence_recovery_chunks WHERE recovery_id = ?"
    ).run(recoveryId);
  }

  markReconciled(spaceId, takeoverId, reconciledAt) {
    this.database.prepare(
      `UPDATE hub_forced_takeovers
       SET status = 'reconciled', reconciled_at = ?
       WHERE space_id = ? AND id = ? AND status = 'accepted'`
    ).run(reconciledAt, spaceId, takeoverId);
  }

  status(spaceId) {
    const takeover = this.latest(spaceId);
    if (!takeover) return null;
    return {
      id: takeover.id,
      previousActiveNodeId: takeover.previous_active_node_id,
      activeNodeId: takeover.active_node_id,
      previousEpoch: Number(takeover.previous_epoch),
      epoch: Number(takeover.epoch),
      status: takeover.status,
      divergentOperationCount: this.divergentCount(spaceId, takeover.id),
      detectedAt: Number(takeover.detected_at),
      reconciledAt: takeover.reconciled_at === null ? null : Number(takeover.reconciled_at)
    };
  }
}

module.exports = { ForcedTakeoverRepository };
