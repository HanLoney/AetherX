const { randomUUID } = require("node:crypto");

class AlbumRepository {
  constructor(database) {
    this.database = database;
  }

  listMoments(userId, filters = {}) {
    const conditions = ["user_id = ?"];
    const values = [userId];
    if (filters.status === "all") {
      // Intentionally include previously hidden cards for the album page.
    } else if (filters.status) {
      conditions.push("status = ?");
      values.push(filters.status);
    } else {
      conditions.push("status != 'hidden'");
    }
    if (filters.q) {
      conditions.push(
        "(title LIKE ? OR summary LIKE ? OR detail LIKE ? OR mood LIKE ?)"
      );
      const pattern = `%${filters.q}%`;
      values.push(pattern, pattern, pattern, pattern);
    }
    values.push(limit(filters.limit, 80));
    return this.database
      .prepare(
        `SELECT * FROM album_moments
         WHERE ${conditions.join(" AND ")}
         ORDER BY occurred_at DESC, updated_at DESC
         LIMIT ?`
      )
      .all(...values)
      .map((row) => this.withSources(userId, mapMoment(row)));
  }

  findMoment(userId, id) {
    const row = this.database
      .prepare("SELECT * FROM album_moments WHERE user_id = ? AND id = ?")
      .get(userId, id);
    return row ? this.withSources(userId, mapMoment(row)) : null;
  }

  saveMoment(userId, input) {
    const now = Date.now();
    const id = input.id || randomUUID();
    const existing = input.id ? this.findMoment(userId, input.id) : null;
    if (existing) {
      this.database
        .prepare(
          `UPDATE album_moments SET
             occurred_at = ?,
             title = ?,
             summary = ?,
             detail = ?,
             mood = ?,
             tags_json = ?,
             importance = ?,
             status = ?,
             updated_at = ?
           WHERE user_id = ? AND id = ?`
        )
        .run(
          input.occurredAt,
          input.title,
          input.summary,
          input.detail,
          input.mood,
          JSON.stringify(input.tags),
          input.importance,
          input.status,
          now,
          userId,
          id
        );
      return this.findMoment(userId, id);
    }
    this.database
      .prepare(
        `INSERT INTO album_moments(
           id, user_id, occurred_at, title, summary, detail, mood,
           tags_json, importance, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        input.occurredAt,
        input.title,
        input.summary,
        input.detail,
        input.mood,
        JSON.stringify(input.tags),
        input.importance,
        input.status,
        now,
        now
      );
    return this.findMoment(userId, id);
  }

  updateMoment(userId, id, input) {
    const current = this.findMoment(userId, id);
    if (!current) return null;
    return this.saveMoment(userId, {
      ...current,
      ...input,
      id
    });
  }

  deleteMoment(userId, id) {
    return this.database
      .prepare("DELETE FROM album_moments WHERE user_id = ? AND id = ?")
      .run(userId, id).changes > 0;
  }

  addSource(userId, momentId, input) {
    const id = randomUUID();
    const now = Date.now();
    this.database
      .prepare(
        `INSERT OR REPLACE INTO album_moment_sources(
           id, moment_id, user_id, source_type, source_id,
           source_excerpt, weight, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        momentId,
        userId,
        input.sourceType,
        input.sourceId,
        input.sourceExcerpt,
        input.weight,
        now
      );
    return this.findMoment(userId, momentId);
  }

  listSources(userId, momentId) {
    return this.database
      .prepare(
        `SELECT * FROM album_moment_sources
         WHERE user_id = ? AND moment_id = ?
         ORDER BY weight DESC, created_at`
      )
      .all(userId, momentId)
      .map(mapSource);
  }

  withSources(userId, moment) {
    if (!moment) return null;
    return {
      ...moment,
      sources: this.listSources(userId, moment.id)
    };
  }

  listSourceCandidates(userId, filters = {}) {
    const since = timestamp(filters.since);
    const limitValue = limit(filters.limit, 30);
    const shared = this.database
      .prepare(
        `SELECT id, content, evidence, importance, updated_at
         FROM shared_memories
         WHERE user_id = ? AND status = 'active'
           AND (? IS NULL OR updated_at >= ?)
         ORDER BY updated_at DESC
         LIMIT ?`
      )
      .all(userId, since, since, limitValue)
      .map((row) => ({
        sourceType: "shared_memory",
        sourceId: row.id,
        title: "共同记忆",
        excerpt: row.content,
        detail: row.evidence,
        occurredAt: row.updated_at,
        weight: row.importance
      }));
    const journals = this.database
      .prepare(
        `SELECT id, title, content, mood, source_to, updated_at
         FROM assistant_journals
         WHERE user_id = ?
           AND (? IS NULL OR updated_at >= ? OR source_to >= ?)
         ORDER BY source_to DESC, updated_at DESC
         LIMIT ?`
      )
      .all(userId, since, since, since, limitValue)
      .map((row) => ({
        sourceType: "journal",
        sourceId: row.id,
        title: row.title,
        excerpt: row.content,
        detail: row.mood,
        occurredAt: row.source_to || row.updated_at,
        weight: 0.72
      }));
    const moodEvents = this.database
      .prepare(
        `SELECT id, summary, emotional_tone, effect_on_xuan, source_created_at, created_at
         FROM xuan_mood_events
         WHERE user_id = ? AND (? IS NULL OR created_at >= ?)
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, since, since, limitValue)
      .map((row) => ({
        sourceType: "mood_event",
        sourceId: row.id,
        title: row.emotional_tone || "心情事件",
        excerpt: row.summary,
        detail: row.effect_on_xuan,
        occurredAt: row.source_created_at || row.created_at,
        weight: 0.62
      }));
    const memories = this.database
      .prepare(
        `SELECT id, content, source_excerpt, importance, updated_at
         FROM memories
         WHERE user_id = ? AND status = 'active'
           AND (? IS NULL OR updated_at >= ?)
         ORDER BY importance DESC, updated_at DESC
         LIMIT ?`
      )
      .all(userId, since, since, Math.ceil(limitValue / 2))
      .map((row) => ({
        sourceType: "memory",
        sourceId: row.id,
        title: "长期记忆",
        excerpt: row.content,
        detail: row.source_excerpt,
        occurredAt: row.updated_at,
        weight: row.importance
      }));
    return [...shared, ...journals, ...moodEvents, ...memories]
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, limitValue);
  }
}

function mapMoment(row) {
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    title: row.title,
    summary: row.summary,
    detail: row.detail,
    mood: row.mood,
    tags: parseJson(row.tags_json, []),
    importance: row.importance,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapSource(row) {
  return {
    id: row.id,
    momentId: row.moment_id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceExcerpt: row.source_excerpt,
    weight: row.weight,
    createdAt: row.created_at
  };
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function limit(value, fallback) {
  const number = Number(value);
  return Math.max(1, Math.min(100, Number.isFinite(number) ? number : fallback));
}

module.exports = { AlbumRepository };
