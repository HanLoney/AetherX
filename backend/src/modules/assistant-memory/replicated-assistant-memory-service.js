const { randomUUID } = require("node:crypto");

class ReplicatedAssistantMemoryService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  getProfile(userId) {
    return this.service.getProfile(userId);
  }

  saveProfile(userId, input) {
    return this.saveProfileWithRequestId(userId, input, internalRequestId()).result;
  }

  saveProfileWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.getProfile(userId);
      const profile = this.service.saveProfile(userId, input);
      return {
        result: profile,
        changes: sameValue(before, profile) ? [] : [assistantProfileUpsert(profile)]
      };
    });
  }

  listEvents(userId, query = {}) {
    return this.service.listEvents(userId, query);
  }

  recordEvent(userId, input) {
    return this.recordEventWithRequestId(userId, input, internalRequestId()).result;
  }

  recordEventWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const beforeProfile = this.service.getProfile(userId);
      const result = this.service.recordEvent(userId, input);
      const afterProfile = this.service.getProfile(userId);
      const event = result?.id
        ? this.service.listEvents(userId, { status: "all" })
            .find((item) => item.id === result.id)
        : null;
      const changes = [];
      if (event && !result.duplicate && !result.filtered) {
        changes.push(personalityEventUpsert(event));
      }
      if (!sameValue(beforeProfile, afterProfile)) {
        changes.push(assistantProfileUpsert(afterProfile));
      }
      return { status: 201, result, changes };
    });
  }

  confirmEvent(userId, id) {
    return this.confirmEventWithRequestId(userId, id, internalRequestId()).result;
  }

  confirmEventWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const beforeProfile = this.service.getProfile(userId);
      const before = this.service.listEvents(userId, { status: "all" })
        .find((item) => item.id === id);
      const event = this.service.confirmEvent(userId, id);
      const afterProfile = this.service.getProfile(userId);
      const changes = [];
      if (!sameValue(before, event)) changes.push(personalityEventUpsert(event));
      if (!sameValue(beforeProfile, afterProfile)) {
        changes.push(assistantProfileUpsert(afterProfile));
      }
      return { result: event, changes };
    });
  }

  deleteEvent(userId, id) {
    this.deleteEventWithRequestId(userId, id, internalRequestId());
  }

  deleteEventWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const event = this.service.listEvents(userId, { status: "all" })
        .find((item) => item.id === id);
      this.service.deleteEvent(userId, id);
      return {
        status: 204,
        result: null,
        changes: event ? [personalityEventDelete(event)] : []
      };
    });
  }

  listSharedMemories(userId, query = {}) {
    return this.service.listSharedMemories(userId, query);
  }

  createSharedMemory(userId, input) {
    return this.createSharedMemoryWithRequestId(
      userId,
      input,
      internalRequestId()
    ).result;
  }

  createSharedMemoryWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const result = this.service.createSharedMemory(userId, input);
      return {
        status: 201,
        result,
        changes: result?.id && !result.duplicate && !result.filtered
          ? [sharedMemoryUpsert(result)]
          : []
      };
    });
  }

  confirmSharedMemory(userId, id) {
    return this.confirmSharedMemoryWithRequestId(
      userId,
      id,
      internalRequestId()
    ).result;
  }

  confirmSharedMemoryWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.listSharedMemories(userId, { status: "all" })
        .find((item) => item.id === id);
      const memory = this.service.confirmSharedMemory(userId, id);
      return {
        result: memory,
        changes: sameValue(before, memory) ? [] : [sharedMemoryUpsert(memory)]
      };
    });
  }

  deleteSharedMemory(userId, id) {
    this.deleteSharedMemoryWithRequestId(userId, id, internalRequestId());
  }

  deleteSharedMemoryWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const memory = this.service.listSharedMemories(userId, { status: "all" })
        .find((item) => item.id === id);
      this.service.deleteSharedMemory(userId, id);
      return {
        status: 204,
        result: null,
        changes: memory ? [sharedMemoryDelete(memory)] : []
      };
    });
  }

  recallSharedMemories(userId, query, limit = 4) {
    return this.service.recallSharedMemories(userId, query, limit);
  }

  context(userId, sharedMemories) {
    return this.service.context(userId, sharedMemories);
  }
}

function assistantProfileUpsert(profile) {
  return {
    entityType: "assistant_profiles",
    entityId: "profile",
    operation: "upsert",
    payload: {
      name: profile.name,
      gender: profile.gender,
      self_definition: profile.selfDefinition,
      relationship_summary: profile.relationshipSummary,
      traits: profile.traits,
      values: profile.values,
      avatar_data_url: profile.avatarDataUrl,
      persona_image_data_url: profile.personaImageDataUrl,
      updated_at: profile.updatedAt
    }
  };
}

function personalityEventUpsert(event) {
  return {
    entityType: "assistant_personality_events",
    entityId: event.id,
    operation: "upsert",
    payload: {
      id: event.id,
      category: event.category,
      trait_key: event.traitKey,
      trait_value: event.traitValue,
      content: event.content,
      evidence: event.evidence,
      source_role: event.sourceRole,
      confidence: event.confidence,
      weight: event.weight,
      status: event.status,
      created_at: event.createdAt
    }
  };
}

function personalityEventDelete(event) {
  return {
    entityType: "assistant_personality_events",
    entityId: event.id,
    operation: "delete",
    payload: { id: event.id, deleted_version_created_at: event.createdAt }
  };
}

function sharedMemoryUpsert(memory) {
  return {
    entityType: "shared_memories",
    entityId: memory.id,
    operation: "upsert",
    payload: {
      id: memory.id,
      memory_type: memory.type,
      content: memory.content,
      participants: memory.participants,
      evidence: memory.evidence,
      source: memory.source,
      confidence: memory.confidence,
      importance: memory.importance,
      status: memory.status,
      created_at: memory.createdAt,
      updated_at: memory.updatedAt
    }
  };
}

function sharedMemoryDelete(memory) {
  return {
    entityType: "shared_memories",
    entityId: memory.id,
    operation: "delete",
    payload: { id: memory.id, deleted_version_updated_at: memory.updatedAt }
  };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = {
  assistantProfileUpsert,
  personalityEventDelete,
  personalityEventUpsert,
  ReplicatedAssistantMemoryService,
  sharedMemoryDelete,
  sharedMemoryUpsert
};
