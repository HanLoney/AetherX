const { randomUUID } = require("node:crypto");

class ConversationRepository {
  constructor(database) {
    this.database = database;
  }

  list(userId) {
    return this.database
      .prepare(
        `SELECT id, title, summary, created_at, updated_at
         FROM conversations WHERE user_id = ? ORDER BY updated_at DESC`
      )
      .all(userId)
      .map(mapConversation);
  }

  find(userId, id) {
    return mapConversation(
      this.database
        .prepare(
          `SELECT id, title, summary, created_at, updated_at
           FROM conversations WHERE user_id = ? AND id = ?`
        )
        .get(userId, id)
    );
  }

  create(userId, title) {
    const id = randomUUID();
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO conversations(id, user_id, title, summary, created_at, updated_at)
         VALUES (?, ?, ?, '', ?, ?)`
      )
      .run(id, userId, title, now, now);
    return this.find(userId, id);
  }

  messages(conversationId) {
    return this.database
      .prepare(
        `SELECT id, stream_type, position, role, content, payload_json, created_at
         FROM messages WHERE conversation_id = ?
         ORDER BY stream_type, position, created_at`
      )
      .all(conversationId)
      .map((row) => ({
        id: row.id,
        stream: row.stream_type,
        position: row.position,
        role: row.role,
        content: row.content,
        payload: JSON.parse(row.payload_json || "{}"),
        createdAt: row.created_at
      }));
  }

  upsertMessages(conversationId, messages) {
    const statement = this.database.prepare(
      `INSERT INTO messages(
        id, conversation_id, stream_type, position, role, content, payload_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        stream_type = excluded.stream_type,
        position = excluded.position,
        role = excluded.role,
        content = excluded.content,
        payload_json = excluded.payload_json
      WHERE messages.conversation_id = excluded.conversation_id`
    );
    const now = Date.now();
    this.database.exec("BEGIN");
    try {
      messages.forEach((message) => {
        statement.run(
          message.id,
          conversationId,
          message.stream,
          message.position,
          message.role,
          message.content,
          JSON.stringify(message.payload),
          message.createdAt || now
        );
      });
      this.database
        .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
        .run(now, conversationId);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  delete(userId, id) {
    return this.database
      .prepare("DELETE FROM conversations WHERE user_id = ? AND id = ?")
      .run(userId, id).changes;
  }
}

function mapConversation(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { ConversationRepository };
