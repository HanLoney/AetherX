const { randomUUID } = require("node:crypto");

const { runInSavepoint } = require("../../infrastructure/transaction");

class ConversationRepository {
  constructor(database) {
    this.database = database;
  }

  list(userId) {
    return this.database
      .prepare(
        `SELECT id, title, summary, created_at, updated_at
         FROM conversations WHERE user_id = ? ORDER BY updated_at DESC, id DESC`
      )
      .all(userId)
      .map(mapConversation);
  }

  primary(userId) {
    return mapConversation(
      this.database
        .prepare(
          `SELECT id, title, summary, created_at, updated_at
           FROM conversations
           WHERE user_id = ?
           ORDER BY updated_at DESC, id DESC
           LIMIT 1`
        )
        .get(userId)
    );
  }

  mergeIntoPrimary(userId) {
    return runInSavepoint(this.database, () => {
      const conversations = this.list(userId);
      const primary = conversations[0] || null;
      if (!primary || conversations.length === 1) {
        return { primary, messages: [], evidence: [], removedConversations: [] };
      }

      const removedConversations = conversations.slice(1);
      const conversationIds = new Set(conversations.map((conversation) => conversation.id));
      const messages = this.database
        .prepare(
          `SELECT m.id, m.conversation_id, m.stream_type, m.position, m.role,
                  m.content, m.payload_json, m.created_at
           FROM messages m
           JOIN conversations c ON c.id = m.conversation_id
           WHERE c.user_id = ?`
        )
        .all(userId)
        .filter((row) => conversationIds.has(row.conversation_id))
        .map(mapMessage);
      const reorderedMessages = ["display", "model"].flatMap((stream) =>
        messages
          .filter((message) => message.stream === stream)
          .sort(compareMessages)
          .map((message, position) => ({ ...message, position }))
      );
      const updateMessage = this.database.prepare(
        "UPDATE messages SET conversation_id = ?, position = ? WHERE id = ?"
      );
      for (const message of reorderedMessages) {
        updateMessage.run(primary.id, message.position, message.id);
      }

      const removedIds = new Set(removedConversations.map((conversation) => conversation.id));
      const evidence = this.database
        .prepare(
          `SELECT id, memory_id, conversation_id, evidence, evidence_hash,
                  confidence, created_at
           FROM memory_evidence
           WHERE user_id = ?`
        )
        .all(userId)
        .filter((row) => removedIds.has(row.conversation_id))
        .map((row) => ({
          id: row.id,
          memoryId: row.memory_id,
          conversationId: primary.id,
          evidence: row.evidence,
          evidenceHash: row.evidence_hash,
          confidence: row.confidence,
          createdAt: row.created_at
        }));
      const updateEvidence = this.database.prepare(
        "UPDATE memory_evidence SET conversation_id = ? WHERE id = ? AND user_id = ?"
      );
      for (const item of evidence) updateEvidence.run(primary.id, item.id, userId);

      const deleteConversation = this.database.prepare(
        "DELETE FROM conversations WHERE user_id = ? AND id = ?"
      );
      for (const conversation of removedConversations) {
        deleteConversation.run(userId, conversation.id);
      }
      return { primary, messages: reorderedMessages, evidence, removedConversations };
    });
  }

  page(userId, offset, limit) {
    const items = this.database
      .prepare(
        `SELECT id, title, summary, created_at, updated_at
         FROM conversations
         WHERE user_id = ?
         ORDER BY updated_at DESC, id DESC
         LIMIT ? OFFSET ?`
      )
      .all(userId, limit, offset)
      .map(mapConversation);
    const total = Number(
      this.database
        .prepare("SELECT COUNT(*) AS count FROM conversations WHERE user_id = ?")
        .get(userId)?.count || 0
    );
    return { items, total };
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
      .map(mapMessage);
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
    const write = () => {
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
    };
    runInSavepoint(this.database, write);
  }

  delete(userId, id) {
    return this.database
      .prepare("DELETE FROM conversations WHERE user_id = ? AND id = ?")
      .run(userId, id).changes;
  }
}

function mapMessage(row) {
  return {
    id: row.id,
    stream: row.stream_type,
    position: row.position,
    role: row.role,
    content: row.content,
    payload: JSON.parse(row.payload_json || "{}"),
    createdAt: row.created_at
  };
}

function compareMessages(left, right) {
  return left.createdAt - right.createdAt ||
    left.position - right.position ||
    compareText(left.id, right.id);
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
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
