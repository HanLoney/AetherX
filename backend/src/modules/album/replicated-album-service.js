const { randomUUID } = require("node:crypto");

class ReplicatedAlbumService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  listMoments(userId, query = {}) {
    return this.service.listMoments(userId, query);
  }

  getMoment(userId, id) {
    return this.service.getMoment(userId, id);
  }

  listSourceCandidates(userId, query = {}) {
    return this.service.listSourceCandidates(userId, query);
  }

  createMoment(userId, input) {
    return this.createMomentWithRequestId(userId, input, internalRequestId()).result;
  }

  createMomentWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const moment = this.service.createMoment(userId, input);
      return {
        status: 201,
        result: moment,
        changes: [albumMomentUpsert(moment), ...moment.sources.map(albumSourceUpsert)]
      };
    });
  }

  updateMoment(userId, id, input) {
    return this.updateMomentWithRequestId(
      userId,
      id,
      input,
      internalRequestId()
    ).result;
  }

  updateMomentWithRequestId(userId, id, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.getMoment(userId, id);
      const moment = this.service.updateMoment(userId, id, input);
      return {
        result: moment,
        changes: sameMoment(before, moment) ? [] : [albumMomentUpsert(moment)]
      };
    });
  }

  hideMoment(userId, id) {
    return this.hideMomentWithRequestId(userId, id, internalRequestId()).result;
  }

  hideMomentWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.getMoment(userId, id);
      const moment = this.service.hideMoment(userId, id);
      return {
        result: moment,
        changes: sameMoment(before, moment) ? [] : [albumMomentUpsert(moment)]
      };
    });
  }

  addSource(userId, momentId, input) {
    return this.addSourceWithRequestId(
      userId,
      momentId,
      input,
      internalRequestId()
    ).result;
  }

  addSourceWithRequestId(userId, momentId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.getMoment(userId, momentId).sources;
      const moment = this.service.addSource(userId, momentId, input);
      return {
        result: moment,
        changes: sourceReplacementChanges(
          before,
          moment.sources,
          albumSourceDelete,
          albumSourceUpsert
        )
      };
    });
  }

  deleteMoment(userId, id) {
    this.deleteMomentWithRequestId(userId, id, internalRequestId());
  }

  deleteMomentWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const moment = this.service.getMoment(userId, id);
      this.service.deleteMoment(userId, id);
      return {
        status: 204,
        result: null,
        changes: [
          ...moment.sources.map(albumSourceDelete),
          albumMomentDelete(moment)
        ]
      };
    });
  }
}

function albumMomentUpsert(moment) {
  return {
    entityType: "album_moments",
    entityId: moment.id,
    operation: "upsert",
    payload: {
      id: moment.id,
      occurred_at: moment.occurredAt,
      title: moment.title,
      summary: moment.summary,
      detail: moment.detail,
      mood: moment.mood,
      tags: moment.tags,
      importance: moment.importance,
      status: moment.status,
      created_at: moment.createdAt,
      updated_at: moment.updatedAt
    }
  };
}

function albumMomentDelete(moment) {
  return deleteChange("album_moments", moment.id, moment.updatedAt);
}

function albumSourceUpsert(source) {
  return {
    entityType: "album_moment_sources",
    entityId: source.id,
    operation: "upsert",
    payload: {
      id: source.id,
      moment_id: source.momentId,
      source_type: source.sourceType,
      source_id: source.sourceId,
      source_excerpt: source.sourceExcerpt,
      weight: source.weight,
      created_at: source.createdAt
    }
  };
}

function albumSourceDelete(source) {
  return deleteChange("album_moment_sources", source.id, source.createdAt);
}

function deleteChange(entityType, id, versionTime) {
  return {
    entityType,
    entityId: id,
    operation: "delete",
    payload: { id, deleted_version_time: versionTime }
  };
}

function sourceReplacementChanges(before, after, remove, add) {
  const beforeIds = new Set(before.map((item) => item.id));
  const afterIds = new Set(after.map((item) => item.id));
  return [
    ...before.filter((item) => !afterIds.has(item.id)).map(remove),
    ...after.filter((item) => !beforeIds.has(item.id)).map(add)
  ];
}

function sameMoment(left, right) {
  const omitSources = (value) => ({ ...value, sources: undefined });
  return JSON.stringify(omitSources(left)) === JSON.stringify(omitSources(right));
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = {
  albumMomentDelete,
  albumMomentUpsert,
  albumSourceDelete,
  albumSourceUpsert,
  ReplicatedAlbumService
};
