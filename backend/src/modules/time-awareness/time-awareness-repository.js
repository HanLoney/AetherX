class TimeAwarenessRepository {
  constructor(database) {
    this.database = database;
  }

  getLastUserInteraction(userId, before) {
    const row = this.database
      .prepare(`
        SELECT m.created_at
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ?
          AND m.stream_type = 'display'
          AND m.role = 'user'
          AND m.created_at < ?
        ORDER BY m.created_at DESC
        LIMIT 1
      `)
      .get(userId, before);
    return row?.created_at || null;
  }
}

module.exports = { TimeAwarenessRepository };
