class ModuleSettingsRepository {
  constructor(database) {
    this.database = database;
  }

  list(userId) {
    return this.database
      .prepare(
        `SELECT module_id, enabled, updated_at
         FROM module_settings WHERE user_id = ?`
      )
      .all(userId)
      .map((row) => ({
        id: row.module_id,
        enabled: row.enabled === 1,
        updatedAt: row.updated_at
      }));
  }

  set(userId, moduleId, enabled) {
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO module_settings(user_id, module_id, enabled, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, module_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(userId, moduleId, enabled ? 1 : 0, now);
    return { id: moduleId, enabled: Boolean(enabled), updatedAt: now };
  }
}

module.exports = { ModuleSettingsRepository };
