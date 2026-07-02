const { randomUUID } = require("node:crypto");

class XuanMoodRepository {
  constructor(database) {
    this.database = database;
  }

  createEvent(userId, input) {
    const id = randomUUID();
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO xuan_mood_events(
          id, user_id, source_type, source_id, source_created_at, summary,
          emotional_tone, effect_on_xuan, intensity, raw_payload_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        input.sourceType,
        input.sourceId || "",
        input.sourceCreatedAt || now,
        input.summary,
        input.emotionalTone || "",
        input.effectOnXuan || "",
        input.intensity || "medium",
        JSON.stringify(input.rawPayload || {}),
        now
      );
    return this.findEvent(userId, id);
  }

  findEvent(userId, id) {
    return mapEvent(
      this.database
        .prepare(
          `SELECT * FROM xuan_mood_events WHERE user_id = ? AND id = ?`
        )
        .get(userId, id)
    );
  }

  listRecentEvents(userId, limit = 12) {
    return this.database
      .prepare(
        `SELECT * FROM xuan_mood_events
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT ?`
      )
      .all(userId, limit)
      .map(mapEvent)
      .reverse();
  }

  getState(userId) {
    const row = this.database
      .prepare(`SELECT state_json, updated_at FROM xuan_mood_state WHERE user_id = ?`)
      .get(userId);
    if (!row) return null;
    return {
      state: parseJson(row.state_json, {}),
      updatedAt: row.updated_at
    };
  }

  saveState(userId, state) {
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO xuan_mood_state(user_id, state_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           state_json = excluded.state_json,
           updated_at = excluded.updated_at`
      )
      .run(userId, JSON.stringify(state || {}), now);
    return this.getState(userId);
  }

  getLatestDisplay(userId) {
    return mapDisplay(
      this.database
        .prepare(
          `SELECT * FROM xuan_mood_displays
           WHERE user_id = ?
           ORDER BY created_at DESC
           LIMIT 1`
        )
        .get(userId)
    );
  }

  saveDisplay(userId, input) {
    const id = randomUUID();
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO xuan_mood_displays(
          id, user_id, title, line, detail, focus, tone,
          based_on_event_ids_json, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        userId,
        input.title,
        input.line,
        input.detail || "",
        input.focus || "",
        input.tone || "quiet",
        JSON.stringify(input.basedOnEventIds || []),
        input.expiresAt,
        now
      );
    return this.getLatestDisplay(userId);
  }
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceCreatedAt: row.source_created_at,
    summary: row.summary,
    emotionalTone: row.emotional_tone,
    effectOnXuan: row.effect_on_xuan,
    intensity: row.intensity,
    rawPayload: parseJson(row.raw_payload_json, {}),
    createdAt: row.created_at
  };
}

function mapDisplay(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    line: row.line,
    detail: row.detail,
    focus: row.focus,
    tone: row.tone,
    basedOnEventIds: parseJson(row.based_on_event_ids_json, []),
    expiresAt: row.expires_at,
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

module.exports = { XuanMoodRepository };
