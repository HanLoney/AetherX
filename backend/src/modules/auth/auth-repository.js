const { randomUUID } = require("node:crypto");

class AuthRepository {
  constructor(database) {
    this.database = database;
  }

  countUsers() {
    return Number(this.database.prepare("SELECT COUNT(*) AS count FROM users").get().count);
  }

  findUserByUsername(username) {
    return this.database
      .prepare("SELECT * FROM users WHERE username = ? COLLATE NOCASE")
      .get(username);
  }

  createUser({ id = randomUUID(), username, displayName, passwordHash, now }) {
    this.database
      .prepare(
        `INSERT INTO users(
          id, username, display_name, password_hash, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, username, displayName, passwordHash, now, now);
    return this.findUserById(id);
  }

  findUserById(id) {
    return this.database.prepare("SELECT * FROM users WHERE id = ?").get(id);
  }

  createSession({ userId, tokenHash, now, expiresAt }) {
    const id = randomUUID();
    this.database
      .prepare(
        `INSERT INTO auth_sessions(
          id, user_id, token_hash, created_at, last_used_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(id, userId, tokenHash, now, now, expiresAt);
    return { id, userId, createdAt: now, lastUsedAt: now, expiresAt };
  }

  findSession(tokenHash) {
    return this.database
      .prepare(
        `SELECT
          s.id AS session_id,
          s.user_id,
          s.last_used_at,
          s.expires_at,
          u.username,
          u.display_name
        FROM auth_sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`
      )
      .get(tokenHash);
  }

  findDeviceSession(tokenHash) {
    return this.database
      .prepare(
        `SELECT
          d.id AS device_id,
          d.user_id,
          d.last_seen_at,
          u.username,
          u.display_name
        FROM paired_devices d
        JOIN users u ON u.id = d.user_id
        WHERE d.token_hash = ? AND d.status = 'active'`
      )
      .get(tokenHash);
  }

  touchDevice(id, now) {
    this.database
      .prepare("UPDATE paired_devices SET last_seen_at = ? WHERE id = ?")
      .run(now, id);
  }

  revokeDeviceByToken(tokenHash, now) {
    return (
      this.database
        .prepare(
          `UPDATE paired_devices
           SET status = 'revoked', revoked_at = ?
           WHERE token_hash = ? AND status = 'active'`
        )
        .run(now, tokenHash).changes > 0
    );
  }

  touchSession(id, now) {
    this.database
      .prepare("UPDATE auth_sessions SET last_used_at = ? WHERE id = ?")
      .run(now, id);
  }

  deleteSession(tokenHash) {
    return (
      this.database
        .prepare("DELETE FROM auth_sessions WHERE token_hash = ?")
        .run(tokenHash).changes > 0
    );
  }

  deleteExpiredSessions(now) {
    this.database.prepare("DELETE FROM auth_sessions WHERE expires_at <= ?").run(now);
  }

  claimLegacyData(userId, legacyUserId = "local-user") {
    const tables = this.database
      .prepare(
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND sql IS NOT NULL
           AND instr(lower(sql), 'user_id') > 0`
      )
      .all()
      .map((row) => row.name)
      .filter(
        (name) =>
          ![
            "users",
            "auth_sessions",
            "paired_devices",
            "device_pairing_sessions",
            "sync_changes"
          ].includes(name) &&
          /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)
      );

    let changed = 0;
    for (const table of tables) {
      changed += this.database
        .prepare(`UPDATE "${table}" SET user_id = ? WHERE user_id = ?`)
        .run(userId, legacyUserId).changes;
    }
    return changed;
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

module.exports = { AuthRepository };
