const { randomUUID } = require("node:crypto");

class PreferenceRepository {
  constructor(database) {
    this.database = database;
  }

  list(userId, category) {
    const rows = category
      ? this.database
          .prepare(
            `SELECT * FROM user_preferences
             WHERE user_id = ? AND category = ? ORDER BY updated_at DESC`
          )
          .all(userId, category)
      : this.database
          .prepare(
            `SELECT * FROM user_preferences
             WHERE user_id = ? ORDER BY category, updated_at DESC`
          )
          .all(userId);
    return rows.map(mapPreference);
  }

  find(userId, id) {
    return mapPreference(
      this.database
        .prepare("SELECT * FROM user_preferences WHERE user_id = ? AND id = ?")
        .get(userId, id)
    );
  }

  save(userId, preference) {
    const now = Date.now();
    const existing = this.database
      .prepare(
        `SELECT id, created_at FROM user_preferences
         WHERE user_id = ? AND category = ? AND preference_key = ?`
      )
      .get(userId, preference.category, preference.key);
    const id = existing?.id || randomUUID();
    this.database
      .prepare(
        `INSERT INTO user_preferences(
          id, user_id, category, preference_key, value_json, source,
          confidence, sensitivity, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, category, preference_key) DO UPDATE SET
          value_json = excluded.value_json,
          source = excluded.source,
          confidence = excluded.confidence,
          sensitivity = excluded.sensitivity,
          updated_at = excluded.updated_at`
      )
      .run(
        id,
        userId,
        preference.category,
        preference.key,
        JSON.stringify(preference.value),
        preference.source,
        preference.confidence,
        preference.sensitivity,
        existing?.created_at || now,
        now
      );
    return this.find(userId, id);
  }

  delete(userId, id) {
    return this.database
      .prepare("DELETE FROM user_preferences WHERE user_id = ? AND id = ?")
      .run(userId, id).changes;
  }
}

function mapPreference(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category,
    key: row.preference_key,
    value: JSON.parse(row.value_json),
    source: row.source,
    confidence: row.confidence,
    sensitivity: row.sensitivity,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { PreferenceRepository };
