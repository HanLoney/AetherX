const { HttpError } = require("../../lib/http-error");

const STATUSES = ["candidate", "active", "hidden", "all"];
const SOURCE_TYPES = [
  "shared_memory",
  "journal",
  "mood_event",
  "conversation_message",
  "memory",
  "manual"
];

class AlbumService {
  constructor(repository) {
    this.repository = repository;
  }

  listMoments(userId, query = {}) {
    return this.repository.listMoments(userId, {
      q: text(query.q, 120),
      status: STATUSES.includes(query.status) ? query.status : "",
      limit: number(query.limit, 50)
    });
  }

  getMoment(userId, id) {
    const moment = this.repository.findMoment(userId, id);
    if (!moment) {
      throw new HttpError(404, "ALBUM_MOMENT_NOT_FOUND", "未找到这张纪念卡。");
    }
    return moment;
  }

  createMoment(userId, input) {
    const moment = this.repository.saveMoment(userId, normalizeMoment(input));
    for (const source of normalizeSources(input.sources)) {
      this.repository.addSource(userId, moment.id, source);
    }
    return this.getMoment(userId, moment.id);
  }

  updateMoment(userId, id, input) {
    this.getMoment(userId, id);
    const current = this.repository.findMoment(userId, id);
    const moment = this.repository.updateMoment(
      userId,
      id,
      normalizeMoment({ ...current, ...input })
    );
    if (!moment) {
      throw new HttpError(404, "ALBUM_MOMENT_NOT_FOUND", "未找到这张纪念卡。");
    }
    return moment;
  }

  hideMoment(userId, id) {
    return this.updateMoment(userId, id, { status: "hidden" });
  }

  deleteMoment(userId, id) {
    if (!this.repository.deleteMoment(userId, id)) {
      throw new HttpError(404, "ALBUM_MOMENT_NOT_FOUND", "未找到这张纪念卡。");
    }
  }

  addSource(userId, momentId, input) {
    this.getMoment(userId, momentId);
    return this.repository.addSource(userId, momentId, normalizeSource(input));
  }

  listSourceCandidates(userId, query = {}) {
    return this.repository.listSourceCandidates(userId, {
      since: query.since,
      limit: number(query.limit, 30)
    });
  }
}

function normalizeMoment(input = {}) {
  const title = text(input.title, 80);
  const summary = text(input.summary, 500);
  if (!title) {
    throw new HttpError(400, "INVALID_ALBUM_MOMENT", "纪念卡标题不能为空。");
  }
  if (!summary) {
    throw new HttpError(400, "INVALID_ALBUM_MOMENT", "纪念卡摘要不能为空。");
  }
  return {
    occurredAt: timestamp(input.occurredAt) || Date.now(),
    title,
    summary,
    detail: text(input.detail, 5000),
    mood: text(input.mood, 80),
    tags: Array.isArray(input.tags)
      ? input.tags.map((item) => text(item, 30)).filter(Boolean).slice(0, 12)
      : [],
    importance: clamp(input.importance ?? 0.6),
    status: STATUSES.includes(input.status) ? input.status : "active"
  };
}

function normalizeSources(sources) {
  return Array.isArray(sources) ? sources.slice(0, 12).map(normalizeSource) : [];
}

function normalizeSource(input = {}) {
  const sourceType = SOURCE_TYPES.includes(input.sourceType)
    ? input.sourceType
    : "manual";
  const sourceId = text(input.sourceId || sourceType, 200);
  return {
    sourceType,
    sourceId,
    sourceExcerpt: text(input.sourceExcerpt, 1000),
    weight: clamp(input.weight ?? 0.6)
  };
}

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function timestamp(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  if (Number.isFinite(number) && number > 0) return number;
  const parsed = new Date(value).getTime();
  if (Number.isFinite(parsed)) return parsed;
  throw new HttpError(400, "INVALID_ALBUM_TIME", "纪念时间格式不正确。");
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0.6;
}

module.exports = { AlbumService };
