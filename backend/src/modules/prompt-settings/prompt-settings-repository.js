const { randomUUID } = require("node:crypto");

class PromptSettingsRepository {
  constructor(database) {
    this.database = database;
  }

  get(userId) {
    const row = this.database
      .prepare("SELECT * FROM prompt_settings WHERE user_id = ?")
      .get(userId);
    return row
      ? {
          settings: JSON.parse(row.settings_json),
          version: row.version,
          updatedAt: row.updated_at
        }
      : null;
  }

  save(userId, settings) {
    const current = this.get(userId);
    const version = (current?.version || 0) + 1;
    const now = Date.now();
    const json = JSON.stringify(settings);
    this.database.exec("BEGIN");
    try {
      this.database.prepare(`
        INSERT INTO prompt_settings(user_id, version, settings_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          version = excluded.version,
          settings_json = excluded.settings_json,
          updated_at = excluded.updated_at
      `).run(userId, version, json, now);
      this.database.prepare(`
        INSERT INTO prompt_setting_versions(
          id, user_id, version, settings_json, created_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(randomUUID(), userId, version, json, now);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.get(userId);
  }

  listVersions(userId) {
    return this.database
      .prepare(`
        SELECT version, settings_json, created_at
        FROM prompt_setting_versions
        WHERE user_id = ?
        ORDER BY version DESC
        LIMIT 30
      `)
      .all(userId)
      .map((row) => ({
        version: row.version,
        settings: JSON.parse(row.settings_json),
        createdAt: row.created_at
      }));
  }

  findVersion(userId, version) {
    const row = this.database
      .prepare(`
        SELECT version, settings_json, created_at
        FROM prompt_setting_versions
        WHERE user_id = ? AND version = ?
      `)
      .get(userId, version);
    return row
      ? {
          version: row.version,
          settings: JSON.parse(row.settings_json),
          createdAt: row.created_at
        }
      : null;
  }
}

module.exports = { PromptSettingsRepository };
