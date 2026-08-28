class TimeAwarenessRepository {
  constructor(database) {
    this.database = database;
  }

  getLastUserInteraction(userId, before) {
    const row = this.getRecentUserInteractions(userId, before, 1)[0];
    return row?.createdAt || null;
  }

  getRecentUserInteractions(userId, before, limit = 5) {
    return this.database
      .prepare(`
        SELECT m.content, m.created_at
        FROM messages m
        INNER JOIN conversations c ON c.id = m.conversation_id
        WHERE c.user_id = ?
          AND m.stream_type = 'display'
          AND m.role = 'user'
          AND m.created_at < ?
        ORDER BY m.created_at DESC
        LIMIT ?
      `)
      .all(userId, before, Math.max(1, Math.min(20, Number(limit) || 5)))
      .map((row) => ({
        content: row.content || "",
        createdAt: row.created_at
      }));
  }
}

module.exports = { TimeAwarenessRepository };
