class MemorySettingsRepository {
  constructor(database) {
    this.database = database;
  }

  get(userId) {
    const row = this.database
      .prepare(
        "SELECT auto_confirm, updated_at FROM memory_settings WHERE user_id = ?"
      )
      .get(userId);
    return {
      autoConfirm: Boolean(row?.auto_confirm),
      updatedAt: row?.updated_at || null
    };
  }

  save(userId, settings) {
    const updatedAt = Date.now();
    this.database
      .prepare(
        `INSERT INTO memory_settings(user_id, auto_confirm, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET
           auto_confirm = excluded.auto_confirm,
           updated_at = excluded.updated_at`
      )
      .run(userId, settings.autoConfirm ? 1 : 0, updatedAt);
    return this.get(userId);
  }
}

module.exports = { MemorySettingsRepository };
