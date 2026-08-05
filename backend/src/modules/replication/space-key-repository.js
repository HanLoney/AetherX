class SpaceKeyRepository {
  constructor(database) {
    this.database = database;
  }

  find(spaceId) {
    return this.database
      .prepare(
        `SELECT key_version, encrypted_sync_key, created_at, rotated_at
         FROM space_data_keys WHERE space_id = ?`
      )
      .get(spaceId);
  }

  save(input) {
    this.database
      .prepare(
        `INSERT INTO space_data_keys(
           space_id, key_version, encrypted_sync_key, created_at, rotated_at
         ) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(space_id) DO UPDATE SET
           key_version = excluded.key_version,
           encrypted_sync_key = excluded.encrypted_sync_key,
           rotated_at = excluded.rotated_at`
      )
      .run(
        input.spaceId,
        input.keyVersion,
        input.encryptedSyncKey,
        input.createdAt,
        input.rotatedAt
      );
    return this.find(input.spaceId);
  }

  listUnsignedOperations(spaceId) {
    return this.database
      .prepare(
        `SELECT operation_id, operation_hash
         FROM replication_operations
         WHERE space_id = ? AND authentication_tag = ''
         ORDER BY origin_node_id, origin_sequence`
      )
      .all(spaceId);
  }

  updateOperationAuthenticationTag(operationId, authenticationTag) {
    this.database
      .prepare(
        `UPDATE replication_operations SET authentication_tag = ?
         WHERE operation_id = ? AND authentication_tag = ''`
      )
      .run(authenticationTag, operationId);
  }
}

module.exports = { SpaceKeyRepository };
