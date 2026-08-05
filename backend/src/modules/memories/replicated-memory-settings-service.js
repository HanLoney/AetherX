const { randomUUID } = require("node:crypto");

class ReplicatedMemorySettingsService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  get(userId) {
    return this.service.get(userId);
  }

  save(userId, input) {
    return this.saveWithRequestId(userId, input, internalRequestId()).result;
  }

  saveWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.get(userId);
      const settings = this.service.save(userId, input);
      return {
        result: settings,
        changes: JSON.stringify(before) === JSON.stringify(settings)
          ? []
          : [{
              entityType: "memory_settings",
              entityId: "settings",
              operation: "upsert",
              payload: {
                auto_confirm: settings.autoConfirm,
                auto_confirm_all: settings.autoConfirmAll,
                updated_at: settings.updatedAt
              }
            }]
      };
    });
  }
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = { ReplicatedMemorySettingsService };
