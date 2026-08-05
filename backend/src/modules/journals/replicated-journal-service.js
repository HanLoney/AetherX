const { randomUUID } = require("node:crypto");

class ReplicatedJournalService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  list(userId, query = {}) {
    return this.service.list(userId, query);
  }

  get(userId, type, periodKey) {
    return this.service.get(userId, type, periodKey);
  }

  sourceMaterial(userId, query) {
    return this.service.sourceMaterial(userId, query);
  }

  save(userId, input) {
    return this.saveWithRequestId(userId, input, internalRequestId()).result;
  }

  saveWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const before = input.id
        ? this.service.repository.findById(userId, String(input.id))
        : null;
      const journal = this.service.save(userId, input);
      return {
        result: journal,
        changes: sameValue(before, journal) ? [] : [journalUpsert(journal)]
      };
    });
  }

  delete(userId, id) {
    this.deleteWithRequestId(userId, id, internalRequestId());
  }

  deleteWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const journal = this.service.repository.findById(userId, String(id));
      this.service.delete(userId, id);
      return {
        status: 204,
        result: null,
        changes: journal ? [journalDelete(journal)] : []
      };
    });
  }
}

function journalUpsert(journal) {
  return {
    entityType: "assistant_journals",
    entityId: journal.id,
    operation: "upsert",
    payload: {
      id: journal.id,
      journal_type: journal.type,
      period_key: journal.periodKey,
      title: journal.title,
      content: journal.content,
      mood: journal.mood,
      source_from: journal.sourceFrom,
      source_to: journal.sourceTo,
      source_message_count: journal.sourceMessageCount,
      created_at: journal.createdAt,
      updated_at: journal.updatedAt
    }
  };
}

function journalDelete(journal) {
  return {
    entityType: "assistant_journals",
    entityId: journal.id,
    operation: "delete",
    payload: { id: journal.id, deleted_version_updated_at: journal.updatedAt }
  };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = { journalDelete, journalUpsert, ReplicatedJournalService };
