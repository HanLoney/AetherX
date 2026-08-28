class GalleryRepository {
  constructor(database) {
    this.database = database;
  }

  journalImageRows(userId) {
    return this.database
      .prepare(
        `SELECT id, title, journal_type AS type, content, source_to AS created_at
         FROM assistant_journals
         WHERE user_id = ? AND content LIKE '%data:image/%'
         ORDER BY source_to DESC, updated_at DESC`
      )
      .all(userId)
      .map((row) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        content: row.content,
        createdAt: row.created_at
      }));
  }

  conversationImageRows(userId) {
    return this.database
      .prepare(
        `SELECT m.id AS id, m.payload_json AS payloadJson, m.created_at AS createdAt,
                c.id AS conversationId, c.title AS conversationTitle
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ?
           AND m.stream_type = 'display'
           AND m.payload_json LIKE '%"image"%'
         ORDER BY m.created_at DESC`
      )
      .all(userId);
  }
}

module.exports = { GalleryRepository };
