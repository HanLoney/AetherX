const { randomUUID } = require("node:crypto");

class HubEndpointRepository {
  constructor(database) {
    this.database = database;
  }

  replaceNodeEndpoints(spaceId, nodeId, endpoints, now = Date.now()) {
    this.database.prepare(
      "DELETE FROM hub_endpoints WHERE space_id = ? AND node_id = ?"
    ).run(spaceId, nodeId);
    const insert = this.database.prepare(
      `INSERT INTO hub_endpoints(
         id, space_id, node_id, transport, address, priority,
         certificate_fingerprint, last_success_at, created_at, updated_at,
         last_failure_at, failure_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, 0)`
    );
    for (const endpoint of endpoints) {
      insert.run(
        randomUUID(),
        spaceId,
        nodeId,
        endpoint.transport,
        endpoint.address,
        endpoint.priority,
        endpoint.certificateFingerprint || "",
        now,
        now
      );
    }
    return this.listForNode(spaceId, nodeId);
  }

  listForNode(spaceId, nodeId) {
    return this.database.prepare(
      `SELECT id, space_id, node_id, transport, address, priority,
              certificate_fingerprint, last_success_at, last_failure_at,
              failure_count, created_at, updated_at
       FROM hub_endpoints
       WHERE space_id = ? AND node_id = ?
       ORDER BY priority DESC,
                CASE WHEN last_success_at IS NULL THEN 1 ELSE 0 END,
                last_success_at DESC,
                address`
    ).all(spaceId, nodeId).map(presentEndpoint);
  }

  listForSpace(spaceId) {
    return this.database.prepare(
      `SELECT id, space_id, node_id, transport, address, priority,
              certificate_fingerprint, last_success_at, last_failure_at,
              failure_count, created_at, updated_at
       FROM hub_endpoints
       WHERE space_id = ?
       ORDER BY node_id, priority DESC, address`
    ).all(spaceId).map(presentEndpoint);
  }

  markSuccess(id, now = Date.now()) {
    this.database.prepare(
      `UPDATE hub_endpoints
       SET last_success_at = ?, last_failure_at = NULL, failure_count = 0,
           updated_at = ?
       WHERE id = ?`
    ).run(now, now, id);
  }

  markFailure(id, now = Date.now()) {
    this.database.prepare(
      `UPDATE hub_endpoints
       SET last_failure_at = ?, failure_count = failure_count + 1,
           updated_at = ?
       WHERE id = ?`
    ).run(now, now, id);
  }
}

function presentEndpoint(row) {
  return {
    id: row.id,
    spaceId: row.space_id,
    nodeId: row.node_id,
    transport: row.transport,
    address: row.address,
    priority: Number(row.priority),
    certificateFingerprint: row.certificate_fingerprint,
    lastSuccessAt: row.last_success_at === null ? null : Number(row.last_success_at),
    lastFailureAt: row.last_failure_at === null ? null : Number(row.last_failure_at),
    failureCount: Number(row.failure_count),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  };
}

module.exports = { HubEndpointRepository };
