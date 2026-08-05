const { randomUUID } = require("node:crypto");

class ReplicatedPromptSettingsService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  getBundle(userId) {
    return this.service.getBundle(userId);
  }

  listVersions(userId) {
    return this.service.listVersions(userId);
  }

  save(userId, input) {
    return this.saveWithRequestId(userId, input, internalRequestId()).result;
  }

  saveWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () =>
      this.captureSave(this.service.save(userId, input, { withinTransaction: true }))
    );
  }

  restore(userId, version) {
    return this.restoreWithRequestId(userId, version, internalRequestId()).result;
  }

  restoreWithRequestId(userId, version, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () =>
      this.captureSave(
        this.service.restore(userId, version, { withinTransaction: true })
      )
    );
  }

  captureSave(saved) {
    const { versionRecord, ...result } = saved;
    return {
      result,
      changes: [
        {
          entityType: "prompt_settings",
          entityId: "settings",
          operation: "upsert",
          payload: {
            version: result.version,
            settings: result.settings,
            updated_at: result.updatedAt
          }
        },
        {
          entityType: "prompt_setting_versions",
          entityId: versionRecord.id,
          operation: "upsert",
          payload: {
            id: versionRecord.id,
            version: versionRecord.version,
            settings: versionRecord.settings,
            created_at: versionRecord.createdAt
          }
        }
      ]
    };
  }
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = { ReplicatedPromptSettingsService };
