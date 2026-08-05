class HubPairingRepository {
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

  create(input) {
    this.database.prepare(
      `INSERT INTO hub_pairing_sessions(
         id, user_id, space_id, secret_hash, status,
         server_ephemeral_public_key, encrypted_server_ephemeral_private_key,
         created_at, expires_at, source_endpoints_json
       ) VALUES (?, ?, ?, ?, 'created', ?, ?, ?, ?, ?)`
    ).run(
      input.id,
      input.userId,
      input.spaceId,
      input.secretHash,
      input.serverEphemeralPublicKey,
      input.encryptedServerEphemeralPrivateKey,
      input.createdAt,
      input.expiresAt,
      JSON.stringify(input.sourceEndpoints || [])
    );
    return this.findForUser(input.userId, input.id);
  }

  findForUser(userId, id) {
    return this.database
      .prepare("SELECT * FROM hub_pairing_sessions WHERE user_id = ? AND id = ?")
      .get(userId, id);
  }

  findBySecret(id, secretHash) {
    return this.database
      .prepare("SELECT * FROM hub_pairing_sessions WHERE id = ? AND secret_hash = ?")
      .get(id, secretHash);
  }

  claim(input) {
    return this.database.prepare(
      `UPDATE hub_pairing_sessions
       SET status = 'pending', requested_node_id = ?, node_name = ?,
           platform = ?, public_identity = ?, client_ephemeral_public_key = ?,
           protocol_version = ?, schema_version = ?, requested_endpoints_json = ?,
           claimed_at = ?
       WHERE id = ? AND secret_hash = ? AND status = 'created'`
    ).run(
      input.nodeId,
      input.nodeName,
      input.platform,
      input.publicIdentity,
      input.clientEphemeralPublicKey,
      input.protocolVersion,
      input.schemaVersion,
      JSON.stringify(input.endpoints || []),
      input.claimedAt,
      input.id,
      input.secretHash
    ).changes > 0;
  }

  approve(userId, id, approvedAt) {
    return this.database.prepare(
      `UPDATE hub_pairing_sessions SET status = 'approved', approved_at = ?
       WHERE user_id = ? AND id = ? AND status = 'pending'`
    ).run(approvedAt, userId, id).changes > 0;
  }

  markRedeemed(id, secretHash, redeemedAt) {
    return this.database.prepare(
      `UPDATE hub_pairing_sessions
       SET status = 'redeemed', redeemed_at = ?,
           encrypted_server_ephemeral_private_key = ''
       WHERE id = ? AND secret_hash = ? AND status = 'approved'`
    ).run(redeemedAt, id, secretHash).changes > 0;
  }

  deleteExpired(now) {
    return this.database.prepare(
      `DELETE FROM hub_pairing_sessions
       WHERE expires_at <= ? AND status IN ('created', 'pending', 'approved')`
    ).run(now).changes;
  }
}

module.exports = { HubPairingRepository };
