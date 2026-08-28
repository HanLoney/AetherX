class SyncRepository {
  constructor(database) {
    this.database = database;
  }

  listChanges(userId, after, limit) {
    return this.database
      .prepare(
        `SELECT seq, entity_type, entity_id, operation, created_at
         FROM sync_changes
         WHERE user_id = ? AND seq > ?
         ORDER BY seq ASC
         LIMIT ?`
      )
      .all(userId, after, limit);
  }

  latestSequence(userId) {
    return Number(
      this.database
        .prepare(
          "SELECT COALESCE(MAX(seq), 0) AS seq FROM sync_changes WHERE user_id = ?"
        )
        .get(userId).seq
    );
  }
}

module.exports = { SyncRepository };
