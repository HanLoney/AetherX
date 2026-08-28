const { randomUUID } = require("node:crypto");

class ReplicatedPreferenceService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  list(userId, query = {}) {
    return this.service.list(userId, query);
  }

  get(userId, id) {
    return this.service.get(userId, id);
  }

  save(userId, input) {
    return this.saveWithRequestId(userId, input, internalRequestId()).result;
  }

  saveWithRequestId(userId, input, requestId, status = 200) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const preference = this.service.save(userId, input);
      return {
        status,
        result: preference,
        changes: [preferenceUpsert(preference)]
      };
    });
  }

  delete(userId, id) {
    this.deleteWithRequestId(userId, id, internalRequestId());
  }

  deleteWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const preference = this.service.get(userId, id);
      this.service.delete(userId, id);
      return {
        status: 204,
        result: null,
        changes: [preferenceDelete(preference)]
      };
    });
  }
}

function preferenceUpsert(preference) {
  return {
    entityType: "user_preferences",
    entityId: preference.id,
    operation: "upsert",
    payload: {
      id: preference.id,
      category: preference.category,
      preference_key: preference.key,
      value: preference.value,
      source: preference.source,
      confidence: preference.confidence,
      sensitivity: preference.sensitivity,
      created_at: preference.createdAt,
      updated_at: preference.updatedAt
    }
  };
}

function preferenceDelete(preference) {
  return {
    entityType: "user_preferences",
    entityId: preference.id,
    operation: "delete",
    payload: {
      id: preference.id,
      category: preference.category,
      preference_key: preference.key,
      deleted_version_updated_at: preference.updatedAt
    }
  };
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = {
  preferenceDelete,
  preferenceUpsert,
  ReplicatedPreferenceService
};
