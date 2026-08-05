const { randomUUID } = require("node:crypto");

class ReplicatedModuleManager {
  constructor(manager, replicationUnitOfWork) {
    this.manager = manager;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  snapshot(userId) {
    return this.manager.snapshot(userId);
  }

  isEnabled(userId, moduleId) {
    return this.manager.isEnabled(userId, moduleId);
  }

  assertEnabled(userId, moduleId) {
    return this.manager.assertEnabled(userId, moduleId);
  }

  moduleForTool(toolName) {
    return this.manager.moduleForTool(toolName);
  }

  setEnabled(userId, moduleId, enabled) {
    return this.setEnabledWithRequestId(
      userId,
      moduleId,
      enabled,
      internalRequestId()
    ).result;
  }

  setEnabledWithRequestId(userId, moduleId, enabled, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = settingsById(this.manager.repository.list(userId));
      const result = this.manager.setEnabled(userId, moduleId, enabled);
      const after = this.manager.repository.list(userId);
      return {
        result,
        changes: after
          .filter((setting) => changed(before.get(setting.id), setting))
          .sort((left, right) => compareText(left.id, right.id))
          .map(moduleSettingUpsert)
      };
    });
  }
}

function moduleSettingUpsert(setting) {
  return {
    entityType: "module_settings",
    entityId: setting.id,
    operation: "upsert",
    payload: {
      module_id: setting.id,
      enabled: setting.enabled,
      updated_at: setting.updatedAt
    }
  };
}

function settingsById(settings) {
  return new Map(settings.map((setting) => [setting.id, setting]));
}

function changed(before, after) {
  return !before ||
    before.enabled !== after.enabled ||
    before.updatedAt !== after.updatedAt;
}

function compareText(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = { moduleSettingUpsert, ReplicatedModuleManager };
