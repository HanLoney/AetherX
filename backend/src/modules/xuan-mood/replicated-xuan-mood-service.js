const { randomUUID } = require("node:crypto");

class ReplicatedXuanMoodService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  async getHome(userId) {
    let home = this.service.inspectHome(userId);
    if (home.needsRefresh) {
      await this.refresh(userId).catch(() => null);
      home = this.service.inspectHome(userId);
    }
    if (home.needsPhysiology) {
      this.ensurePhysiologyWithRequestId(userId, internalRequestId());
    }
    return this.service.snapshot(userId);
  }

  async recordEvent(userId, input = {}) {
    return (await this.recordEventWithRequestId(
      userId,
      input,
      internalRequestId()
    )).result;
  }

  async recordEventWithRequestId(userId, input, requestId) {
    const repeated = this.replicationUnitOfWork.findRepeated(userId, requestId);
    if (repeated) return repeated;
    const prepared = await this.service.prepareEvent(userId, input);
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.snapshot(userId);
      const result = this.service.commitEvent(userId, prepared);
      return {
        status: 201,
        result,
        changes: moodChanges(before, result, result.event)
      };
    });
  }

  async refresh(userId) {
    return (await this.refreshWithRequestId(userId, internalRequestId())).result;
  }

  async refreshWithRequestId(userId, requestId) {
    const repeated = this.replicationUnitOfWork.findRepeated(userId, requestId);
    if (repeated) return repeated;
    const prepared = await this.service.prepareRefresh(userId);
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.snapshot(userId);
      const result = this.service.commitRefresh(userId, prepared);
      return { result, changes: moodChanges(before, result) };
    });
  }

  ensurePhysiologyWithRequestId(userId, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.snapshot(userId);
      const result = this.service.ensurePhysiology(userId);
      return { result, changes: moodChanges(before, result) };
    });
  }

  snapshot(userId) {
    return this.service.snapshot(userId);
  }
}

function moodChanges(before, after, event = null) {
  const changes = [];
  if (event) changes.push(moodEventUpsert(event));
  if (!sameValue(before?.state, after?.state) && after?.state) {
    changes.push(moodStateUpsert(after.state));
  }
  if (!sameValue(before?.display, after?.display) && after?.display) {
    changes.push(moodDisplayUpsert(after.display));
  }
  return changes;
}

function moodEventUpsert(event) {
  return {
    entityType: "xuan_mood_events",
    entityId: event.id,
    operation: "upsert",
    payload: {
      id: event.id,
      source_type: event.sourceType,
      source_id: event.sourceId,
      source_created_at: event.sourceCreatedAt,
      summary: event.summary,
      emotional_tone: event.emotionalTone,
      effect_on_xuan: event.effectOnXuan,
      intensity: event.intensity,
      raw_payload: event.rawPayload,
      created_at: event.createdAt
    }
  };
}

function moodStateUpsert(stateRecord) {
  return {
    entityType: "xuan_mood_state",
    entityId: "state",
    operation: "upsert",
    payload: { state: stateRecord.state, updated_at: stateRecord.updatedAt }
  };
}

function moodDisplayUpsert(display) {
  return {
    entityType: "xuan_mood_displays",
    entityId: display.id,
    operation: "upsert",
    payload: {
      id: display.id,
      title: display.title,
      line: display.line,
      detail: display.detail,
      focus: display.focus,
      tone: display.tone,
      based_on_event_ids: display.basedOnEventIds,
      expires_at: display.expiresAt,
      created_at: display.createdAt
    }
  };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = {
  moodDisplayUpsert,
  moodEventUpsert,
  moodStateUpsert,
  ReplicatedXuanMoodService
};
