const { randomUUID } = require("node:crypto");

class JournalRepository {
  constructor(database) {
    this.database = database;
  }

  list(userId, filters = {}) {
    const conditions = ["user_id = ?"];
    const values = [userId];
    if (filters.type) {
      conditions.push("journal_type = ?");
      values.push(filters.type);
    }
    if (filters.q) {
      conditions.push("(title LIKE ? OR content LIKE ? OR mood LIKE ?)");
      const pattern = `%${filters.q}%`;
      values.push(pattern, pattern, pattern);
    }
    values.push(filters.limit);
    return this.database
      .prepare(
        `SELECT * FROM assistant_journals
         WHERE ${conditions.join(" AND ")}
         ORDER BY source_to DESC LIMIT ?`
      )
      .all(...values)
      .map(mapJournal);
  }

  find(userId, type, periodKey) {
    return mapJournal(
      this.database
        .prepare(
          `SELECT * FROM assistant_journals
           WHERE user_id = ? AND journal_type = ? AND period_key = ?`
        )
        .get(userId, type, periodKey)
    );
  }

  save(userId, journal) {
    const existing = this.find(userId, journal.type, journal.periodKey);
    const id = existing?.id || randomUUID();
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO assistant_journals(
          id, user_id, journal_type, period_key, title, content, mood,
          source_from, source_to, source_message_count, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, journal_type, period_key) DO UPDATE SET
          title = excluded.title,
          content = excluded.content,
          mood = excluded.mood,
          source_from = excluded.source_from,
          source_to = excluded.source_to,
          source_message_count = excluded.source_message_count,
          updated_at = excluded.updated_at`
      )
      .run(
        id,
        userId,
        journal.type,
        journal.periodKey,
        journal.title,
        journal.content,
        journal.mood,
        journal.sourceFrom,
        journal.sourceTo,
        journal.sourceMessageCount,
        existing?.createdAt || now,
        now
      );
    return this.find(userId, journal.type, journal.periodKey);
  }

  sourceMaterial(userId, from, to) {
    const messages = this.database
      .prepare(
        `SELECT c.id AS conversation_id, c.title AS conversation_title,
                m.role, m.content, m.created_at
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ?
           AND m.stream_type = 'display'
           AND m.role IN ('user', 'assistant')
           AND m.content IS NOT NULL
           AND m.created_at >= ? AND m.created_at < ?
         ORDER BY m.created_at, c.id, m.position`
      )
      .all(userId, from, to)
      .map((row) => ({
        conversationId: row.conversation_id,
        conversationTitle: row.conversation_title,
        role: row.role,
        content: row.content,
        createdAt: row.created_at
      }));
    const personalityEvents = this.database
      .prepare(
        `SELECT category, trait_key, trait_value, content, evidence, created_at
         FROM assistant_personality_events
         WHERE user_id = ? AND created_at >= ? AND created_at < ?
         ORDER BY created_at`
      )
      .all(userId, from, to)
      .map((row) => ({
        category: row.category,
        traitKey: row.trait_key,
        traitValue: row.trait_value,
        content: row.content,
        evidence: row.evidence,
        createdAt: row.created_at
      }));
    const sharedMemories = this.database
      .prepare(
        `SELECT content, evidence, created_at
         FROM shared_memories
         WHERE user_id = ? AND created_at >= ? AND created_at < ?
         ORDER BY created_at`
      )
      .all(userId, from, to)
      .map((row) => ({
        content: row.content,
        evidence: row.evidence,
        createdAt: row.created_at
      }));
    const todos = this.database
      .prepare(
        `SELECT text, start_at, end_at, completed, updated_at
         FROM todos
         WHERE user_id = ?
           AND (start_at < ? AND end_at >= ? OR updated_at >= ? AND updated_at < ?)
         ORDER BY start_at`
      )
      .all(userId, to, from, from, to)
      .map((row) => ({
        text: row.text,
        startAt: row.start_at,
        endAt: row.end_at,
        completed: Boolean(row.completed),
        updatedAt: row.updated_at
      }));
    return { messages, personalityEvents, sharedMemories, todos };
  }
}

function mapJournal(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.journal_type,
    periodKey: row.period_key,
    title: row.title,
    content: row.content,
    mood: row.mood,
    sourceFrom: row.source_from,
    sourceTo: row.source_to,
    sourceMessageCount: row.source_message_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { JournalRepository };
