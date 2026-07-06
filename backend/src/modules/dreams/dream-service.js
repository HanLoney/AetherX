const { HttpError } = require("../../lib/http-error");

const STATUSES = ["active", "archived", "all"];
const SOURCE_TYPES = [
  "chat",
  "journal",
  "memory",
  "shared_memory",
  "mood_event",
  "manual"
];
const DEFAULT_REALITY_NOTE =
  "这是一段由真实聊天、手记和记忆激发的虚构梦境，不代表现实发生过。";

class DreamService {
  constructor(repository) {
    this.repository = repository;
  }

  listDreams(userId, query = {}) {
    return this.repository.listDreams(userId, {
      q: text(query.q, 120),
      status: STATUSES.includes(query.status) ? query.status : "",
      limit: number(query.limit, 50)
    });
  }

  getDream(userId, id) {
    const dream = this.repository.findDream(userId, id);
    if (!dream) {
      throw new HttpError(404, "DREAM_NOT_FOUND", "未找到这段梦境。");
    }
    return dream;
  }

  getDreamByDate(userId, dreamDate) {
    const dream = this.repository.findByDate(userId, dateKey(dreamDate));
    if (!dream) {
      throw new HttpError(404, "DREAM_NOT_FOUND", "未找到这段梦境。");
    }
    return dream;
  }

  createDream(userId, input) {
    const dream = this.repository.saveDream(userId, normalizeDream(input));
    for (const source of normalizeSources(input.sources)) {
      this.repository.addSource(userId, dream.id, source);
    }
    return this.getDream(userId, dream.id);
  }

  updateDream(userId, id, input) {
    const current = this.getDream(userId, id);
    const dream = this.repository.saveDream(userId, {
      ...normalizeDream({ ...current, ...input }),
      id
    });
    return this.getDream(userId, dream.id);
  }

  deleteDream(userId, id) {
    if (!this.repository.deleteDream(userId, id)) {
      throw new HttpError(404, "DREAM_NOT_FOUND", "未找到这段梦境。");
    }
  }

  addSource(userId, dreamId, input) {
    this.getDream(userId, dreamId);
    return this.repository.addSource(userId, dreamId, normalizeSource(input));
  }

  sourceMaterial(userId, query = {}) {
    const from = timestamp(query.from);
    const to = timestamp(query.to);
    if (to <= from || to - from > 9 * 86400_000) {
      throw new HttpError(400, "INVALID_DREAM_RANGE", "梦境素材周期不正确。");
    }
    return {
      from,
      to,
      sources: this.repository.sourceMaterial(userId, from, to, number(query.limit, 60))
    };
  }
}

function normalizeDream(input = {}) {
  const title = text(input.title, 100);
  const content = text(input.content, 20_000);
  if (!title) {
    throw new HttpError(400, "INVALID_DREAM", "梦境标题不能为空。");
  }
  if (!content) {
    throw new HttpError(400, "INVALID_DREAM", "梦境正文不能为空。");
  }
  const sourceFrom = timestamp(input.sourceFrom ?? Date.now() - 86400_000);
  const sourceTo = timestamp(input.sourceTo ?? Date.now());
  if (sourceTo <= sourceFrom || sourceTo - sourceFrom > 9 * 86400_000) {
    throw new HttpError(400, "INVALID_DREAM_RANGE", "梦境素材周期不正确。");
  }
  return {
    dreamDate: dateKey(input.dreamDate),
    title,
    content,
    mood: text(input.mood, 100),
    symbols: Array.isArray(input.symbols)
      ? input.symbols.map((item) => text(item, 30)).filter(Boolean).slice(0, 16)
      : [],
    realityNote: text(input.realityNote, 300) || DEFAULT_REALITY_NOTE,
    sourceFrom,
    sourceTo,
    status: STATUSES.includes(input.status) && input.status !== "all"
      ? input.status
      : "active"
  };
}

function normalizeSources(sources) {
  return Array.isArray(sources) ? sources.slice(0, 16).map(normalizeSource) : [];
}

function normalizeSource(input = {}) {
  const sourceType = SOURCE_TYPES.includes(input.sourceType)
    ? input.sourceType
    : "manual";
  return {
    sourceType,
    sourceId: text(input.sourceId || sourceType, 200),
    sourceExcerpt: text(input.sourceExcerpt, 1200),
    weight: clamp(input.weight ?? 0.6)
  };
}

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function timestamp(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  throw new HttpError(400, "INVALID_DREAM_TIME", "梦境时间不正确。");
}

function dateKey(value) {
  const result = text(value, 20);
  if (/^\d{4}-\d{2}-\d{2}$/.test(result)) return result;
  throw new HttpError(400, "INVALID_DREAM_DATE", "梦境日期不正确。");
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.min(100, parsed)) : fallback;
}

function clamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.6;
}

module.exports = { DreamService, DEFAULT_REALITY_NOTE };
