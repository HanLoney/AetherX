const AUTO_APPROVE_WRITES_SETTING_ID = "__agent_auto_approve_writes__";

class AgentPermissionRepository {
  constructor(database) {
    this.database = database;
  }

  get(userId) {
    const row = this.database
      .prepare(
        `SELECT enabled, updated_at
         FROM module_settings
         WHERE user_id = ? AND module_id = ?`
      )
      .get(userId, AUTO_APPROVE_WRITES_SETTING_ID);
    return {
      autoApproveWrites: row?.enabled === 1,
      updatedAt: row?.updated_at ?? null
    };
  }

  set(userId, autoApproveWrites) {
    const now = Date.now();
    this.database
      .prepare(
        `INSERT INTO module_settings(user_id, module_id, enabled, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, module_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
      )
      .run(
        userId,
        AUTO_APPROVE_WRITES_SETTING_ID,
        autoApproveWrites ? 1 : 0,
        now
      );
    return {
      autoApproveWrites: Boolean(autoApproveWrites),
      updatedAt: now
    };
  }
}

module.exports = {
  AgentPermissionRepository,
  AUTO_APPROVE_WRITES_SETTING_ID
};
