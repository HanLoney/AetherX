const { randomUUID } = require("node:crypto");

class DeviceRepository {
  constructor(database) {
    this.database = database;
  }

  createPairingSession({ id = randomUUID(), userId, secretHash, now, expiresAt }) {
    this.database
      .prepare(
        `INSERT INTO device_pairing_sessions(
          id, user_id, secret_hash, status, expires_at, created_at
        ) VALUES (?, ?, ?, 'created', ?, ?)`
      )
      .run(id, userId, secretHash, expiresAt, now);
    return this.findPairingSessionForUser(userId, id);
  }

  findPairingSessionForUser(userId, id) {
    return this.database
      .prepare(
        `SELECT * FROM device_pairing_sessions
         WHERE user_id = ? AND id = ?`
      )
      .get(userId, id);
  }

  findPairingSessionBySecret(id, secretHash) {
    return this.database
      .prepare(
        `SELECT * FROM device_pairing_sessions
         WHERE id = ? AND secret_hash = ?`
      )
      .get(id, secretHash);
  }

  claimPairingSession({ id, secretHash, deviceName, publicKey }) {
    return (
      this.database
        .prepare(
          `UPDATE device_pairing_sessions
           SET status = 'pending', device_name = ?, public_key = ?
           WHERE id = ? AND secret_hash = ? AND status = 'created'`
        )
        .run(deviceName, publicKey, id, secretHash).changes > 0
    );
  }

  approvePairingSession(userId, id, now) {
    return (
      this.database
        .prepare(
          `UPDATE device_pairing_sessions
           SET status = 'approved', approved_at = ?
           WHERE user_id = ? AND id = ? AND status = 'pending'`
        )
        .run(now, userId, id).changes > 0
    );
  }

  createDevice({ id = randomUUID(), userId, name, publicKey, tokenHash, now }) {
    this.database
      .prepare(
        `INSERT INTO paired_devices(
          id, user_id, name, public_key, token_hash, status,
          created_at, last_seen_at
        ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
      )
      .run(id, userId, name, publicKey, tokenHash, now, now);
    return this.findDevice(userId, id);
  }

  markPairingSessionRedeemed(id, secretHash, deviceId, now) {
    return (
      this.database
        .prepare(
          `UPDATE device_pairing_sessions
           SET status = 'redeemed', redeemed_at = ?, device_id = ?
           WHERE id = ? AND secret_hash = ? AND status = 'approved'`
        )
        .run(now, deviceId, id, secretHash).changes > 0
    );
  }

  listDevices(userId) {
    return this.database
      .prepare(
        `SELECT * FROM paired_devices
         WHERE user_id = ?
         ORDER BY created_at DESC`
      )
      .all(userId);
  }

  findDevice(userId, id) {
    return this.database
      .prepare("SELECT * FROM paired_devices WHERE user_id = ? AND id = ?")
      .get(userId, id);
  }

  revokeDevice(userId, id, now) {
    return (
      this.database
        .prepare(
          `UPDATE paired_devices
           SET status = 'revoked', revoked_at = ?
           WHERE user_id = ? AND id = ? AND status = 'active'`
        )
        .run(now, userId, id).changes > 0
    );
  }

  upsertMobileHealth(input) {
    this.database.prepare(
      `INSERT INTO mobile_client_health(
        id, user_id, paired_device_id, name, platform, model, os_version,
        app_version, protocol_version, sync_status, sync_cursor, sse_connected, foreground,
        latency_ms, last_error, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id, user_id) DO UPDATE SET
        paired_device_id = excluded.paired_device_id,
        name = excluded.name,
        platform = excluded.platform,
        model = excluded.model,
        os_version = excluded.os_version,
        app_version = excluded.app_version,
        protocol_version = excluded.protocol_version,
        sync_status = excluded.sync_status,
        sync_cursor = excluded.sync_cursor,
        sse_connected = excluded.sse_connected,
        foreground = excluded.foreground,
        latency_ms = excluded.latency_ms,
        last_error = excluded.last_error,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = excluded.updated_at`
    ).run(
      input.id,
      input.userId,
      input.pairedDeviceId,
      input.name,
      input.platform,
      input.model,
      input.osVersion,
      input.appVersion,
      input.protocolVersion,
      input.syncStatus,
      input.syncCursor,
      input.sseConnected ? 1 : 0,
      input.foreground ? 1 : 0,
      input.latencyMs,
      input.lastError,
      input.now,
      input.now,
      input.now
    );
    return this.findMobileHealth(input.userId, input.id);
  }

  findMobileHealth(userId, id) {
    return this.database.prepare(
      "SELECT * FROM mobile_client_health WHERE user_id = ? AND id = ?"
    ).get(userId, id);
  }

  listMobileHealth(userId) {
    return this.database.prepare(
      `SELECT * FROM mobile_client_health
       WHERE user_id = ? ORDER BY last_heartbeat_at DESC`
    ).all(userId);
  }

  listAllMobileHealth() {
    return this.database.prepare(
      `SELECT * FROM mobile_client_health ORDER BY last_heartbeat_at DESC`
    ).all();
  }

  updateMobileConnection(userId, id, connected, cursor, now) {
    return this.database.prepare(
      `UPDATE mobile_client_health
       SET sse_connected = ?, sync_cursor = MAX(sync_cursor, ?), updated_at = ?
       WHERE user_id = ? AND id = ?`
    ).run(connected ? 1 : 0, cursor, now, userId, id).changes > 0;
  }

  deleteExpiredPairingSessions(now) {
    this.database
      .prepare(
        `DELETE FROM device_pairing_sessions
         WHERE expires_at <= ? AND status IN ('created', 'pending')`
      )
      .run(now);
  }

  transaction(run) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = run();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }
}

module.exports = { DeviceRepository };
