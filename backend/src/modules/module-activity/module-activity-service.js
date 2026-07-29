const { randomUUID } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");
const { MODULE_BY_ID } = require("../module-settings/module-manifest");

const ACTIVITY_STATUSES = new Set(["running", "success", "error", "waiting"]);

class ModuleActivityService {
  constructor(options = {}) {
    this.maxEventsPerUser = Math.max(40, Number(options.maxEventsPerUser) || 240);
    this.sequence = 0;
    this.eventsByUser = new Map();
    this.activeCalls = new Map();
  }

  begin(userId, input = {}) {
    return this.record(userId, { ...input, status: "running" });
  }

  finish(userId, callId, input = {}) {
    return this.record(userId, { ...input, callId, status: input.status || "success" });
  }

  record(userId, input = {}) {
    const owner = String(userId || "");
    const callId = String(input.callId || randomUUID());
    const activeKey = `${owner}:${callId}`;
    const previous = this.activeCalls.get(activeKey) || {};
    const sourceModuleId = moduleId(input.sourceModuleId || previous.sourceModuleId, "sourceModuleId");
    const targetModuleId = moduleId(input.targetModuleId || previous.targetModuleId, "targetModuleId");
    const status = activityStatus(input.status);
    const startedAt = finiteTimestamp(input.startedAt || previous.startedAt || Date.now());
    const createdAt = finiteTimestamp(input.createdAt || Date.now());
    const durationMs = status === "running"
      ? null
      : Math.max(0, Math.round(Number(input.durationMs) || createdAt - startedAt));
    const metadata = {
      callId,
      sourceModuleId,
      targetModuleId,
      operation: String(input.operation || previous.operation || "模块调用").trim().slice(0, 80),
      startedAt
    };
    if (status === "running" || status === "waiting") this.activeCalls.set(activeKey, metadata);
    else this.activeCalls.delete(activeKey);

    const event = Object.freeze({
      seq: ++this.sequence,
      id: randomUUID(),
      ...metadata,
      status,
      durationMs,
      createdAt
    });
    const events = this.eventsByUser.get(owner) || [];
    events.push(event);
    if (events.length > this.maxEventsPerUser) events.splice(0, events.length - this.maxEventsPerUser);
    this.eventsByUser.set(owner, events);
    return event;
  }

  list(userId, query = {}) {
    const events = this.eventsByUser.get(String(userId || "")) || [];
    const limit = Math.min(120, Math.max(1, Number(query.limit) || 60));
    const hasCursor = query.after !== undefined && query.after !== "";
    const after = hasCursor ? cursor(query.after) : null;
    const selected = hasCursor
      ? events.filter((event) => event.seq > after).slice(0, limit)
      : events.slice(-limit);
    return {
      events: selected,
      nextCursor: selected.at(-1)?.seq || events.at(-1)?.seq || 0,
      hasMore: hasCursor && events.some((event) => event.seq > (selected.at(-1)?.seq || after))
    };
  }
}

function moduleId(value, field) {
  const id = String(value || "");
  if (MODULE_BY_ID.has(id)) return id;
  throw new HttpError(400, "INVALID_MODULE_ACTIVITY", `无效的模块调用端点：${field}。`);
}

function activityStatus(value) {
  const status = String(value || "running");
  if (ACTIVITY_STATUSES.has(status)) return status;
  throw new HttpError(400, "INVALID_MODULE_ACTIVITY", "无效的模块调用状态。");
}

function finiteTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp > 0 ? Math.round(timestamp) : Date.now();
}

function cursor(value) {
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;
  throw new HttpError(400, "INVALID_MODULE_ACTIVITY_CURSOR", "模块调用游标无效。");
}

module.exports = { ModuleActivityService };
