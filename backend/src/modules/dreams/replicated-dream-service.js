const { randomUUID } = require("node:crypto");

class ReplicatedDreamService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  listDreams(userId, query = {}) {
    return this.service.listDreams(userId, query);
  }

  getDream(userId, id) {
    return this.service.getDream(userId, id);
  }

  getDreamByDate(userId, date) {
    return this.service.getDreamByDate(userId, date);
  }

  sourceMaterial(userId, query = {}) {
    return this.service.sourceMaterial(userId, query);
  }

  createDream(userId, input) {
    return this.createDreamWithRequestId(userId, input, internalRequestId()).result;
  }

  createDreamWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const dream = this.service.createDream(userId, input);
      return {
        status: 201,
        result: dream,
        changes: [dreamUpsert(dream), ...dream.sources.map(dreamSourceUpsert)]
      };
    });
  }

  updateDream(userId, id, input) {
    return this.updateDreamWithRequestId(userId, id, input, internalRequestId()).result;
  }

  updateDreamWithRequestId(userId, id, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.getDream(userId, id);
      const dream = this.service.updateDream(userId, id, input);
      return {
        result: dream,
        changes: sameDream(before, dream) ? [] : [dreamUpsert(dream)]
      };
    });
  }

  addSource(userId, dreamId, input) {
    return this.addSourceWithRequestId(
      userId,
      dreamId,
      input,
      internalRequestId()
    ).result;
  }

  addSourceWithRequestId(userId, dreamId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.getDream(userId, dreamId).sources;
      const dream = this.service.addSource(userId, dreamId, input);
      const beforeIds = new Set(before.map((item) => item.id));
      const afterIds = new Set(dream.sources.map((item) => item.id));
      return {
        result: dream,
        changes: [
          ...before.filter((item) => !afterIds.has(item.id)).map(dreamSourceDelete),
          ...dream.sources.filter((item) => !beforeIds.has(item.id)).map(dreamSourceUpsert)
        ]
      };
    });
  }

  deleteDream(userId, id) {
    this.deleteDreamWithRequestId(userId, id, internalRequestId());
  }

  deleteDreamWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const dream = this.service.getDream(userId, id);
      this.service.deleteDream(userId, id);
      return {
        status: 204,
        result: null,
        changes: [...dream.sources.map(dreamSourceDelete), dreamDelete(dream)]
      };
    });
  }
}

function dreamUpsert(dream) {
  return {
    entityType: "assistant_dreams",
    entityId: dream.id,
    operation: "upsert",
    payload: {
      id: dream.id,
      dream_date: dream.dreamDate,
      title: dream.title,
      content: dream.content,
      mood: dream.mood,
      symbols: dream.symbols,
      reality_note: dream.realityNote,
      source_from: dream.sourceFrom,
      source_to: dream.sourceTo,
      status: dream.status,
      created_at: dream.createdAt,
      updated_at: dream.updatedAt
    }
  };
}

function dreamDelete(dream) {
  return deleteChange("assistant_dreams", dream.id, dream.updatedAt);
}

function dreamSourceUpsert(source) {
  return {
    entityType: "assistant_dream_sources",
    entityId: source.id,
    operation: "upsert",
    payload: {
      id: source.id,
      dream_id: source.dreamId,
      source_type: source.sourceType,
      source_id: source.sourceId,
      source_excerpt: source.sourceExcerpt,
      weight: source.weight,
      created_at: source.createdAt
    }
  };
}

function dreamSourceDelete(source) {
  return deleteChange("assistant_dream_sources", source.id, source.createdAt);
}

function deleteChange(entityType, id, versionTime) {
  return {
    entityType,
    entityId: id,
    operation: "delete",
    payload: { id, deleted_version_time: versionTime }
  };
}

function sameDream(left, right) {
  const omitSources = (value) => ({ ...value, sources: undefined });
  return JSON.stringify(omitSources(left)) === JSON.stringify(omitSources(right));
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = {
  dreamDelete,
  dreamSourceDelete,
  dreamSourceUpsert,
  dreamUpsert,
  ReplicatedDreamService
};
