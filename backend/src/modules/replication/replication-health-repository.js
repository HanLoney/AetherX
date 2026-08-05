class ReplicationHealthRepository {
  constructor(database) {
    this.database = database;
  }

  find(spaceId, peerNodeId) {
    const row = this.database.prepare(
      `SELECT space_id, peer_node_id, state, last_attempt_at, last_success_at,
              last_error_code, last_error_message, consecutive_failures,
              next_attempt_at, local_sequence, remote_sequence, updated_at
       FROM replication_peer_health
       WHERE space_id = ? AND peer_node_id = ?`
    ).get(spaceId, peerNodeId);
    return row ? presentHealth(row) : null;
  }

  save(input) {
    this.database.prepare(
      `INSERT INTO replication_peer_health(
         space_id, peer_node_id, state, last_attempt_at, last_success_at,
         last_error_code, last_error_message, consecutive_failures,
         next_attempt_at, local_sequence, remote_sequence, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(space_id, peer_node_id) DO UPDATE SET
         state = excluded.state,
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = excluded.last_success_at,
         last_error_code = excluded.last_error_code,
         last_error_message = excluded.last_error_message,
         consecutive_failures = excluded.consecutive_failures,
         next_attempt_at = excluded.next_attempt_at,
         local_sequence = excluded.local_sequence,
         remote_sequence = excluded.remote_sequence,
         updated_at = excluded.updated_at`
    ).run(
      input.spaceId,
      input.peerNodeId,
      input.state,
      input.lastAttemptAt,
      input.lastSuccessAt,
      input.lastErrorCode || "",
      input.lastErrorMessage || "",
      input.consecutiveFailures || 0,
      input.nextAttemptAt,
      input.localSequence || 0,
      input.remoteSequence || 0,
      input.updatedAt
    );
    return this.find(input.spaceId, input.peerNodeId);
  }
}

function presentHealth(row) {
  return {
    spaceId: row.space_id,
    peerNodeId: row.peer_node_id,
    state: row.state,
    lastAttemptAt: nullableNumber(row.last_attempt_at),
    lastSuccessAt: nullableNumber(row.last_success_at),
    lastErrorCode: row.last_error_code,
    lastErrorMessage: row.last_error_message,
    consecutiveFailures: Number(row.consecutive_failures),
    nextAttemptAt: nullableNumber(row.next_attempt_at),
    localSequence: Number(row.local_sequence),
    remoteSequence: Number(row.remote_sequence),
    lagOperations: Math.max(0, Number(row.remote_sequence) - Number(row.local_sequence)),
    updatedAt: Number(row.updated_at)
  };
}

function nullableNumber(value) {
  return value === null ? null : Number(value);
}

module.exports = { ReplicationHealthRepository };
