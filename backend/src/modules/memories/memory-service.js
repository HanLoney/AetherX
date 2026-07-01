const { HttpError } = require("../../lib/http-error");

const STATUSES = ["candidate", "active", "archived"];
const SOURCES = ["explicit", "inferred", "imported"];
const SENSITIVITY = ["normal", "personal", "sensitive"];

class MemoryService {
  constructor(repository) {
    this.repository = repository;
  }

  list(userId, query) {
    if (!query.q) return this.repository.list(userId, query);
    return this.repository.search(userId, query.q).filter((memory) => {
      return (
        (!query.domain || memory.domain === query.domain) &&
        (!query.type || memory.type === query.type) &&
        (!query.status || memory.status === query.status)
      );
    });
  }

  get(userId, id) {
    const memory = this.repository.find(userId, id);
    if (!memory) throw new HttpError(404, "MEMORY_NOT_FOUND", "未找到指定记忆。");
    return memory;
  }

  create(userId, input) {
    return this.repository.create(userId, normalize(input));
  }

  update(userId, id, input) {
    const current = this.get(userId, id);
    return this.repository.update(userId, id, normalize({ ...current, ...input }));
  }

  confirm(userId, id) {
    this.get(userId, id);
    return this.repository.update(userId, id, {
      status: "active",
      source: "explicit",
      confidence: 1
    });
  }

  delete(userId, id) {
    if (!this.repository.delete(userId, id)) {
      throw new HttpError(404, "MEMORY_NOT_FOUND", "未找到指定记忆。");
    }
  }
}

function normalize(input) {
  const content = String(input.content ?? "").trim().slice(0, 5000);
  if (!content) throw new HttpError(400, "INVALID_MEMORY", "记忆内容不能为空。");
  const source = SOURCES.includes(input.source) ? input.source : "explicit";
  const status = STATUSES.includes(input.status)
    ? input.status
    : source === "inferred"
      ? "candidate"
      : "active";
  return {
    domain: String(input.domain || "life").trim().slice(0, 60),
    type: String(input.type || "fact").trim().slice(0, 60),
    content,
    entities: Array.isArray(input.entities)
      ? input.entities.map((item) => String(item).trim()).filter(Boolean).slice(0, 30)
      : [],
    sourceMessageId: input.sourceMessageId || null,
    sourceExcerpt: String(input.sourceExcerpt || "").trim().slice(0, 500),
    memoryKey: String(input.memoryKey || "").trim().slice(0, 200),
    mergeCount: Math.max(1, Number(input.mergeCount) || 1),
    source,
    confidence: clamp(input.confidence ?? (source === "explicit" ? 1 : 0.6)),
    importance: clamp(input.importance ?? 0.5),
    sensitivity: SENSITIVITY.includes(input.sensitivity)
      ? input.sensitivity
      : "normal",
    validFrom: timestamp(input.validFrom),
    validUntil: timestamp(input.validUntil),
    status
  };
}

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function timestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = new Date(value).getTime();
  if (!Number.isFinite(result)) {
    throw new HttpError(400, "INVALID_MEMORY_TIME", "记忆有效期格式不正确。");
  }
  return result;
}

module.exports = { MemoryService };
