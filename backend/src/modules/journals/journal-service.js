const { HttpError } = require("../../lib/http-error");

class JournalService {
  constructor(repository) {
    this.repository = repository;
  }

  list(userId, query = {}) {
    return this.repository.list(userId, {
      type: journalType(query.type, true),
      q: text(query.q, 100),
      limit: Math.max(1, Math.min(100, Number(query.limit) || 30))
    });
  }

  get(userId, type, periodKey) {
    return this.repository.find(
      userId,
      journalType(type),
      period(periodKey)
    );
  }

  save(userId, input) {
    const content = text(input.content, 30_000);
    if (!content) {
      throw new HttpError(400, "INVALID_JOURNAL", "手记正文不能为空。");
    }
    const sourceFrom = timestamp(input.sourceFrom);
    const sourceTo = timestamp(input.sourceTo);
    if (sourceTo <= sourceFrom || sourceTo - sourceFrom > 9 * 86400_000) {
      throw new HttpError(400, "INVALID_JOURNAL_RANGE", "手记素材周期不正确。");
    }
    return this.repository.save(userId, {
      id: text(input.id, 120),
      type: journalType(input.type),
      periodKey: period(input.periodKey),
      title: text(input.title, 200) || "小玄手记",
      content,
      mood: text(input.mood, 100),
      sourceFrom,
      sourceTo,
      sourceMessageCount: Math.max(0, Number(input.sourceMessageCount) || 0)
    });
  }

  delete(userId, id) {
    if (!this.repository.delete(userId, text(id, 120))) {
      throw new HttpError(404, "JOURNAL_NOT_FOUND", "未找到指定手记。");
    }
  }

  sourceMaterial(userId, query) {
    const from = timestamp(query.from);
    const to = timestamp(query.to);
    if (to <= from || to - from > 9 * 86400_000) {
      throw new HttpError(400, "INVALID_JOURNAL_RANGE", "素材周期不正确。");
    }
    return {
      from,
      to,
      ...this.repository.sourceMaterial(userId, from, to)
    };
  }
}

function journalType(value, optional = false) {
  const result = String(value || "");
  if (optional && !result) return "";
  if (!["daily", "weekly"].includes(result)) {
    throw new HttpError(400, "INVALID_JOURNAL_TYPE", "手记类型不正确。");
  }
  return result;
}

function period(value) {
  const result = String(value || "").trim().slice(0, 20);
  if (!/^\d{4}-(?:\d{2}-\d{2}|W\d{2})$/.test(result)) {
    throw new HttpError(400, "INVALID_JOURNAL_PERIOD", "手记周期不正确。");
  }
  return result;
}

function timestamp(value) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0) {
    throw new HttpError(400, "INVALID_JOURNAL_TIME", "手记时间不正确。");
  }
  return result;
}

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

module.exports = { JournalService };
