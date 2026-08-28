const { HttpError } = require("../../lib/http-error");

class SyncService {
  constructor(repository) {
    this.repository = repository;
  }

  listChanges(userId, input = {}) {
    const after = nonNegativeInteger(input.after, "INVALID_SYNC_CURSOR");
    const limit = boundedLimit(input.limit, 100, 500);
    const rows = this.repository.listChanges(userId, after, limit + 1);
    const hasMore = rows.length > limit;
    const changes = rows.slice(0, limit).map(presentChange);
    return {
      changes,
      nextCursor: changes.at(-1)?.seq ?? after,
      hasMore
    };
  }
}

function presentChange(row) {
  return {
    seq: Number(row.seq),
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    createdAt: row.created_at
  };
}

function nonNegativeInteger(value, code) {
  if (value === undefined || value === "") return 0;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new HttpError(400, code, "同步游标无效。");
  }
  return number;
}

function boundedLimit(value, fallback, maximum) {
  if (value === undefined || value === "") return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new HttpError(400, "INVALID_SYNC_LIMIT", "同步条数无效。");
  }
  return Math.min(number, maximum);
}

module.exports = { SyncService, presentChange };
