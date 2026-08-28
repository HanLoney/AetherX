const { canonicalStringify } = require("./operation-codec");

class ReplicationRepository {
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

  findIdempotency(spaceId, requestId) {
    const row = this.database
      .prepare(
        `SELECT result_status, result_hash, result_json, created_at, expires_at
         FROM idempotency_requests WHERE space_id = ? AND request_id = ?`
      )
      .get(spaceId, requestId);
    if (!row) return null;
    return {
      status: Number(row.result_status),
      resultHash: row.result_hash,
      result: JSON.parse(row.result_json),
      createdAt: row.created_at,
      expiresAt: row.expires_at
    };
  }

  saveIdempotency(input) {
    this.database
      .prepare(
        `INSERT INTO idempotency_requests(
           space_id, request_id, result_status, result_hash, result_json,
           created_at, expires_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.spaceId,
        input.requestId,
        input.status,
        input.resultHash,
        canonicalStringify(input.result),
        input.createdAt,
        input.expiresAt
      );
  }

  latestOperation(spaceId, originNodeId) {
    return mapOperation(
      this.database
        .prepare(
          `SELECT * FROM replication_operations
           WHERE space_id = ? AND origin_node_id = ?
           ORDER BY origin_sequence DESC LIMIT 1`
        )
        .get(spaceId, originNodeId)
    );
  }

  findOperation(spaceId, originNodeId, sequence) {
    return mapOperation(
      this.database
        .prepare(
          `SELECT * FROM replication_operations
           WHERE space_id = ? AND origin_node_id = ? AND origin_sequence = ?`
        )
        .get(spaceId, originNodeId, sequence)
    );
  }

  findOperationById(operationId) {
    return mapOperation(
      this.database
        .prepare("SELECT * FROM replication_operations WHERE operation_id = ?")
        .get(operationId)
    );
  }

  listOperationHeads(spaceId) {
    return this.database
      .prepare(
        `SELECT operation.origin_node_id, operation.origin_sequence,
                operation.operation_hash
         FROM replication_operations AS operation
         JOIN (
           SELECT origin_node_id, MAX(origin_sequence) AS origin_sequence
           FROM replication_operations
           WHERE space_id = ?
           GROUP BY origin_node_id
         ) AS head
           ON head.origin_node_id = operation.origin_node_id
          AND head.origin_sequence = operation.origin_sequence
         WHERE operation.space_id = ?
         ORDER BY operation.origin_node_id`
      )
      .all(spaceId, spaceId)
      .map((row) => ({
        originNodeId: row.origin_node_id,
        contiguousSequence: Number(row.origin_sequence),
        operationHash: row.operation_hash
      }));
  }

  advanceEntityVersion(spaceId, entityType, entityId, now) {
    const current = this.database
      .prepare(
        `SELECT version FROM replication_entity_versions
         WHERE space_id = ? AND entity_type = ? AND entity_id = ?`
      )
      .get(spaceId, entityType, entityId);
    const previousEntityVersion = current ? Number(current.version) : null;
    const entityVersion = (previousEntityVersion || 0) + 1;
    this.database
      .prepare(
        `INSERT INTO replication_entity_versions(
           space_id, entity_type, entity_id, version, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(space_id, entity_type, entity_id) DO UPDATE SET
           version = excluded.version,
           updated_at = excluded.updated_at`
      )
      .run(spaceId, entityType, entityId, entityVersion, now);
    return { entityVersion, previousEntityVersion };
  }

  insertOperation(operation) {
    this.database
      .prepare(
        `INSERT INTO replication_operations(
           operation_id, space_id, origin_node_id, origin_sequence, epoch,
           entity_type, entity_id, operation, entity_version,
           previous_entity_version, payload_json, payload_hash,
           previous_operation_hash, operation_hash, authentication_tag, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        operation.operationId,
        operation.spaceId,
        operation.originNodeId,
        operation.originSequence,
        operation.epoch,
        operation.entityType,
        operation.entityId,
        operation.operation,
        operation.entityVersion,
        operation.previousEntityVersion,
        canonicalStringify(operation.payload),
        operation.payloadHash,
        operation.previousOperationHash,
        operation.operationHash,
        operation.authenticationTag,
        operation.createdAt
      );
    return operation;
  }

  findEntityVersion(spaceId, entityType, entityId) {
    const row = this.database
      .prepare(
        `SELECT version, updated_at FROM replication_entity_versions
         WHERE space_id = ? AND entity_type = ? AND entity_id = ?`
      )
      .get(spaceId, entityType, entityId);
    return row
      ? { version: Number(row.version), updatedAt: Number(row.updated_at) }
      : null;
  }

  setEntityVersion(spaceId, entityType, entityId, version, updatedAt) {
    this.database
      .prepare(
        `INSERT INTO replication_entity_versions(
           space_id, entity_type, entity_id, version, updated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(space_id, entity_type, entity_id) DO UPDATE SET
           version = excluded.version,
           updated_at = excluded.updated_at`
      )
      .run(spaceId, entityType, entityId, version, updatedAt);
  }

  isApplied(operationId) {
    return Boolean(
      this.database
        .prepare("SELECT 1 FROM applied_operations WHERE operation_id = ?")
        .get(operationId)
    );
  }

  markApplied(operationId, spaceId, appliedAt) {
    this.database
      .prepare(
        `INSERT INTO applied_operations(operation_id, space_id, applied_at)
         VALUES (?, ?, ?)`
      )
      .run(operationId, spaceId, appliedAt);
  }

  listOperations(spaceId, originNodeId, after = 0, limit = 200) {
    return this.database
      .prepare(
        `SELECT * FROM replication_operations
         WHERE space_id = ? AND origin_node_id = ? AND origin_sequence > ?
         ORDER BY origin_sequence ASC LIMIT ?`
      )
      .all(spaceId, originNodeId, after, limit)
      .map(mapOperation);
  }

  findAcknowledgement(spaceId, peerNodeId, originNodeId) {
    const row = this.database
      .prepare(
        `SELECT contiguous_sequence, operation_hash, acknowledged_at
         FROM replication_watermarks
         WHERE space_id = ? AND peer_node_id = ? AND origin_node_id = ?`
      )
      .get(spaceId, peerNodeId, originNodeId);
    return row
      ? {
          peerNodeId,
          originNodeId,
          contiguousSequence: Number(row.contiguous_sequence),
          operationHash: row.operation_hash,
          acknowledgedAt: Number(row.acknowledged_at)
        }
      : null;
  }

  saveAcknowledgement(input) {
    this.database
      .prepare(
        `INSERT INTO replication_watermarks(
           space_id, peer_node_id, origin_node_id, contiguous_sequence,
           operation_hash, acknowledged_at
         ) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(space_id, peer_node_id, origin_node_id) DO UPDATE SET
           contiguous_sequence = excluded.contiguous_sequence,
           operation_hash = excluded.operation_hash,
           acknowledged_at = excluded.acknowledged_at`
      )
      .run(
        input.spaceId,
        input.peerNodeId,
        input.originNodeId,
        input.contiguousSequence,
        input.operationHash,
        input.acknowledgedAt
      );
    return this.findAcknowledgement(
      input.spaceId,
      input.peerNodeId,
      input.originNodeId
    );
  }

  listAcknowledgements(spaceId, peerNodeId) {
    return this.database
      .prepare(
        `SELECT origin_node_id, contiguous_sequence, operation_hash,
                acknowledged_at
         FROM replication_watermarks
         WHERE space_id = ? AND peer_node_id = ?
         ORDER BY origin_node_id`
      )
      .all(spaceId, peerNodeId)
      .map((row) => ({
        peerNodeId,
        originNodeId: row.origin_node_id,
        contiguousSequence: Number(row.contiguous_sequence),
        operationHash: row.operation_hash,
        acknowledgedAt: Number(row.acknowledged_at)
      }));
  }
}

function mapOperation(row) {
  if (!row) return null;
  return {
    protocolVersion: 1,
    operationId: row.operation_id,
    spaceId: row.space_id,
    originNodeId: row.origin_node_id,
    originSequence: Number(row.origin_sequence),
    epoch: Number(row.epoch),
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    entityVersion: Number(row.entity_version),
    previousEntityVersion: row.previous_entity_version === null
      ? null
      : Number(row.previous_entity_version),
    payload: JSON.parse(row.payload_json),
    payloadHash: row.payload_hash,
    previousOperationHash: row.previous_operation_hash,
    operationHash: row.operation_hash,
    authenticationTag: row.authentication_tag,
    createdAt: Number(row.created_at)
  };
}

module.exports = { ReplicationRepository, mapOperation };
