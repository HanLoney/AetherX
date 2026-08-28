class PeerCredentialRepository {
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

  find(spaceId, peerNodeId) {
    return this.database
      .prepare(
        `SELECT key_id, encrypted_shared_secret, created_at, rotated_at, revoked_at
         FROM hub_peer_credentials
         WHERE space_id = ? AND peer_node_id = ?`
      )
      .get(spaceId, peerNodeId);
  }

  save(input) {
    this.database
      .prepare(
        `INSERT INTO hub_peer_credentials(
           space_id, peer_node_id, key_id, encrypted_shared_secret,
           created_at, rotated_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(space_id, peer_node_id) DO UPDATE SET
           key_id = excluded.key_id,
           encrypted_shared_secret = excluded.encrypted_shared_secret,
           rotated_at = excluded.rotated_at,
           revoked_at = NULL`
      )
      .run(
        input.spaceId,
        input.peerNodeId,
        input.keyId,
        input.encryptedSharedSecret,
        input.createdAt,
        input.rotatedAt
      );
    return this.find(input.spaceId, input.peerNodeId);
  }

  findNonce(spaceId, peerNodeId, nonce) {
    return this.database
      .prepare(
        `SELECT request_timestamp, seen_at FROM peer_request_nonces
         WHERE space_id = ? AND peer_node_id = ? AND nonce = ?`
      )
      .get(spaceId, peerNodeId, nonce);
  }

  saveNonce(input) {
    this.database
      .prepare(
        `INSERT INTO peer_request_nonces(
           space_id, peer_node_id, nonce, request_timestamp, seen_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        input.spaceId,
        input.peerNodeId,
        input.nonce,
        input.requestTimestamp,
        input.seenAt
      );
  }

  deleteExpiredNonces(before) {
    return this.database
      .prepare("DELETE FROM peer_request_nonces WHERE seen_at < ?")
      .run(before).changes;
  }
}

module.exports = { PeerCredentialRepository };
