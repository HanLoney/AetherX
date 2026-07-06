const { randomUUID } = require("node:crypto");

class DreamRepository {
  constructor(database) {
    this.database = database;
  }

  listDreams(userId, filters = {}) {
    const conditions = ["user_id = ?"];
    const values = [userId];
    if (filters.status === "all") {
      // Include archived dreams when explicitly requested.
    } else if (filters.status) {
      conditions.push("status = ?");
      values.push(filters.status);
    } else {
      conditions.push("status != 'archived'");
    }
    if (filters.q) {
      conditions.push(
        "(title LIKE ? OR content LIKE ? OR mood LIKE ? OR reality_note LIKE ?)"
      );
      const pattern = `%${filters.q}%`;
      values.push(pattern, pattern, pattern, pattern);
    }
    values.push(limit(filters.limit, 50));
    return this.database
      .prepare(
        `SELECT * FROM assistant_dreams
         WHERE ${conditions.join(" AND ")}
         ORDER BY dream_date DESC, updated_at DESC
         LIMIT ?`
      )
      .all(...values)
      .map((row) => this.withSources(userId, mapDream(row)));
  }

  findDream(userId, id) {
    const row = this.database
      .prepare("SELECT * FROM assistant_dreams WHERE user_id = ? AND id = ?")
      .get(userId, id);
    return row ? this.withSources(userId, mapDream(row)) : null;
  }

  findByDate(userId, dreamDate) {
    const row = this.database
      .prepare(
        `SELECT * FROM assistant_dreams
         WHERE user_id = ? AND dream_date = ?
         ORDER BY updated_at DESC
         LIMIT 1`
      )
      .get(userId, dreamDate);
    return row ? this.withSources(userId, mapDream(row)) : null;
  }

  saveDream(userId, input) {
    const now = Date.now();
    const id = input.id || randomUUID();
    const existing = input.id ? this.findDream(userId, input.id) : null;
    if (existing) {
      this.database
        .prepare(
          `UPDATE assistant_dreams SET
             dream_date = ?,
             title = ?,
             content = ?,
             mood = ?,
             symbols_json = ?,
             reality_note = ?,
             source_from = ?,
             source_to = ?,
             status = ?,
             updated_at = ?
           WHERE user_id = ? AND id = ?`
        )
        .run(
          input.dreamDate,
          input.title,
          input.content,
          input.mood,
          JSON.stringify(input.symbols),
          input.realityNote,
          input.sourceFrom,
          input.sourceTo,
          input.status,
          now,
          userId,
          id
        );
      return this.findDream(userId, id);
    }
    this.database
      .prepare(
        `INSERT INTO assistant_dreams(
           id, user_id, dream_date, title, content, mood, symbols_json,
           reality_note, source_from, source_to, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        input.dreamDate,
        input.title,
        input.content,
        input.mood,
        JSON.stringify(input.symbols),
        input.realityNote,
        input.sourceFrom,
        input.sourceTo,
        input.status,
        now,
        now
      );
    return this.findDream(userId, id);
  }

  deleteDream(userId, id) {
    return this.database
      .prepare("DELETE FROM assistant_dreams WHERE user_id = ? AND id = ?")
      .run(userId, id).changes > 0;
  }

  addSource(userId, dreamId, input) {
    const id = randomUUID();
    const now = Date.now();
    this.database
      .prepare(
        `INSERT OR REPLACE INTO assistant_dream_sources(
           id, dream_id, user_id, source_type, source_id,
           source_excerpt, weight, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        dreamId,
        userId,
        input.sourceType,
        input.sourceId,
        input.sourceExcerpt,
        input.weight,
        now
      );
    return this.findDream(userId, dreamId);
  }

  listSources(userId, dreamId) {
    return this.database
      .prepare(
        `SELECT * FROM assistant_dream_sources
         WHERE user_id = ? AND dream_id = ?
         ORDER BY weight DESC, created_at`
      )
      .all(userId, dreamId)
      .map(mapSource);
  }

  withSources(userId, dream) {
    if (!dream) return null;
    return {
      ...dream,
      isDream: true,
      sources: this.listSources(userId, dream.id)
    };
  }

  sourceMaterial(userId, from, to, limitValue = 60) {
    const messages = this.database
      .prepare(
        `SELECT c.id AS conversation_id, c.title AS conversation_title,
                m.id, m.role, m.content, m.created_at
         FROM messages m
         JOIN conversations c ON c.id = m.conversation_id
         WHERE c.user_id = ?
           AND m.stream_type = 'display'
           AND m.role IN ('user', 'assistant')
           AND m.content IS NOT NULL
           AND m.created_at >= ? AND m.created_at < ?
         ORDER BY m.created_at DESC, c.id, m.position
         LIMIT ?`
      )
      .all(userId, from, to, limitValue)
      .map((row) => ({
        sourceType: "chat",
        sourceId: row.id || row.conversation_id,
        title: row.conversation_title,
        excerpt: row.content,
        detail: row.role,
        occurredAt: row.created_at,
        weight: row.role === "user" ? 0.7 : 0.55
      }));
    const journals = this.database
      .prepare(
        `SELECT id, title, content, mood, source_to, updated_at
         FROM assistant_journals
         WHERE user_id = ?
           AND (source_to >= ? AND source_to <= ? OR updated_at >= ? AND updated_at < ?)
         ORDER BY source_to DESC, updated_at DESC
         LIMIT ?`
      )
      .all(userId, from, to, from, to, limitValue)
      .map((row) => ({
        sourceType: "journal",
        sourceId: row.id,
        title: row.title,
        excerpt: row.content,
        detail: row.mood,
        occurredAt: row.source_to || row.updated_at,
        weight: 0.86
      }));
    const sharedMemories = this.database
      .prepare(
        `SELECT id, content, evidence, importance, updated_at
         FROM shared_memories
         WHERE user_id = ? AND status = 'active'
           AND updated_at >= ? AND updated_at < ?
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(userId, from, to, limitValue)
      .map((row) => ({
        sourceType: "shared_memory",
        sourceId: row.id,
        title: "共同记忆",
        excerpt: row.content,
        detail: row.evidence,
        occurredAt: row.updated_at,
        weight: row.importance
      }));
    const moodEvents = this.database
      .prepare(
        `SELECT id, summary, emotional_tone, effect_on_xuan, source_created_at, created_at
         FROM xuan_mood_events
         WHERE user_id = ? AND created_at >= ? AND created_at < ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, from, to, limitValue)
      .map((row) => ({
        sourceType: "mood_event",
        sourceId: row.id,
        title: row.emotional_tone || "心情事件",
        excerpt: row.summary,
        detail: row.effect_on_xuan,
        occurredAt: row.source_created_at || row.created_at,
        weight: 0.68
      }));
    const memories = this.database
      .prepare(
        `SELECT id, content, source_excerpt, importance, updated_at
         FROM memories
         WHERE user_id = ? AND status = 'active'
           AND updated_at >= ? AND updated_at < ?
         ORDER BY importance DESC, updated_at DESC
         LIMIT ?`
      )
      .all(userId, from, to, Math.ceil(limitValue / 2))
      .map((row) => ({
        sourceType: "memory",
        sourceId: row.id,
        title: "长期记忆",
        excerpt: row.content,
        detail: row.source_excerpt,
        occurredAt: row.updated_at,
        weight: row.importance
      }));
    return [...messages, ...journals, ...sharedMemories, ...moodEvents, ...memories]
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, limitValue);
  }
}

function mapDream(row) {
  return {
    id: row.id,
    dreamDate: row.dream_date,
    title: row.title,
    content: row.content,
    mood: row.mood,
    symbols: parseJson(row.symbols_json, []),
    realityNote: row.reality_note,
    sourceFrom: row.source_from,
    sourceTo: row.source_to,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSource(row) {
  return {
    id: row.id,
    dreamId: row.dream_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceExcerpt: row.source_excerpt,
    weight: row.weight,
    createdAt: row.created_at
  };
}

function parseJson(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function limit(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(100, parsed))
    : fallback;
}

module.exports = { DreamRepository };
