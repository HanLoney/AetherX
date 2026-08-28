const { randomUUID } = require("node:crypto");

class ReplicatedMemoryService {
  constructor(service, replicationUnitOfWork, evidenceRepository) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
    this.evidenceRepository = evidenceRepository;
  }

  list(userId, query = {}) {
    return this.service.list(userId, query);
  }

  get(userId, id) {
    return this.service.get(userId, id);
  }

  create(userId, input) {
    return this.createWithRequestId(userId, input, internalRequestId()).result;
  }

  createWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const memory = this.service.create(userId, input);
      return { status: 201, result: memory, changes: [memoryUpsert(memory)] };
    });
  }

  update(userId, id, input) {
    return this.updateWithRequestId(userId, id, input, internalRequestId()).result;
  }

  updateWithRequestId(userId, id, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.get(userId, id);
      const memory = this.service.update(userId, id, input);
      return {
        result: memory,
        changes: sameValue(before, memory) ? [] : [memoryUpsert(memory)]
      };
    });
  }

  confirm(userId, id) {
    return this.confirmWithRequestId(userId, id, internalRequestId()).result;
  }

  confirmWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = this.service.get(userId, id);
      const memory = this.service.confirm(userId, id);
      return {
        result: memory,
        changes: sameValue(before, memory) ? [] : [memoryUpsert(memory)]
      };
    });
  }

  delete(userId, id) {
    this.deleteWithRequestId(userId, id, internalRequestId());
  }

  deleteWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const memory = this.service.get(userId, id);
      const evidence = this.evidenceRepository.listForMemory(userId, id);
      this.service.delete(userId, id);
      return {
        status: 204,
        result: null,
        changes: [
          ...evidence.map(memoryEvidenceDelete),
          memoryDelete(memory)
        ]
      };
    });
  }
}

class ReplicatedMemoryEvidenceRepository {
  constructor(repository, replicationUnitOfWork) {
    this.repository = repository;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  hash(conversationId, evidence) {
    return this.repository.hash(conversationId, evidence);
  }

  listByHash(userId, evidenceHash) {
    return this.repository.listByHash(userId, evidenceHash);
  }

  listForMemory(userId, memoryId) {
    return this.repository.listForMemory(userId, memoryId);
  }

  add(userId, memoryId, input) {
    return this.addWithRequestId(
      userId,
      memoryId,
      input,
      internalRequestId()
    ).result;
  }

  addWithRequestId(userId, memoryId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const evidenceHash = input.evidenceHash || this.repository.hash(
        input.conversationId,
        input.evidence
      );
      const before = this.repository
        .listForMemory(userId, memoryId)
        .find((item) => item.evidenceHash === evidenceHash);
      const evidence = this.repository.add(userId, memoryId, {
        ...input,
        evidenceHash
      });
      return {
        result: evidence,
        changes: !evidence || before ? [] : [memoryEvidenceUpsert(evidence)]
      };
    });
  }
}

function memoryUpsert(memory) {
  return {
    entityType: "memories",
    entityId: memory.id,
    operation: "upsert",
    payload: {
      id: memory.id,
      domain: memory.domain,
      memory_type: memory.type,
      content: memory.content,
      entities: memory.entities,
      source_message_id: memory.sourceMessageId,
      source_excerpt: memory.sourceExcerpt,
      memory_key: memory.memoryKey,
      merge_count: memory.mergeCount,
      source: memory.source,
      confidence: memory.confidence,
      importance: memory.importance,
      sensitivity: memory.sensitivity,
      valid_from: memory.validFrom,
      valid_until: memory.validUntil,
      last_confirmed_at: memory.lastConfirmedAt,
      status: memory.status,
      created_at: memory.createdAt,
      updated_at: memory.updatedAt
    }
  };
}

function memoryDelete(memory) {
  return {
    entityType: "memories",
    entityId: memory.id,
    operation: "delete",
    payload: { id: memory.id, deleted_version_updated_at: memory.updatedAt }
  };
}

function memoryEvidenceUpsert(evidence) {
  return {
    entityType: "memory_evidence",
    entityId: evidence.id,
    operation: "upsert",
    payload: {
      id: evidence.id,
      memory_id: evidence.memoryId,
      conversation_id: evidence.conversationId,
      evidence: evidence.evidence,
      evidence_hash: evidence.evidenceHash,
      confidence: evidence.confidence,
      created_at: evidence.createdAt
    }
  };
}

function memoryEvidenceDelete(evidence) {
  return {
    entityType: "memory_evidence",
    entityId: evidence.id,
    operation: "delete",
    payload: {
      id: evidence.id,
      memory_id: evidence.memoryId,
      deleted_version_created_at: evidence.createdAt
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
  memoryDelete,
  memoryEvidenceDelete,
  memoryEvidenceUpsert,
  memoryUpsert,
  ReplicatedMemoryEvidenceRepository,
  ReplicatedMemoryService
};
