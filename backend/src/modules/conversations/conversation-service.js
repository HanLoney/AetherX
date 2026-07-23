const { HttpError } = require("../../lib/http-error");
const DEFAULT_PAGE_LIMIT = 12;
const MAX_PAGE_LIMIT = 50;

class ConversationService {
  constructor(repository) {
    this.repository = repository;
  }

  list(userId) {
    return this.repository.list(userId);
  }

  page(userId, query = {}) {
    const limit = boundedInteger(query.limit, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT);
    const offset = nonNegativeInteger(query.offset);
    const result = this.repository.page(userId, offset, limit);
    return {
      ...result,
      offset,
      limit,
      hasMore: offset + result.items.length < result.total
    };
  }

  create(userId, input) {
    const title = String(input.title || "新对话").trim().slice(0, 120) || "新对话";
    return this.repository.create(userId, title);
  }

  get(userId, id) {
    const conversation = this.repository.find(userId, id);
    if (!conversation) {
      throw new HttpError(404, "CONVERSATION_NOT_FOUND", "未找到指定会话。");
    }
    const messages = this.repository.messages(id);
    return {
      conversation,
      displayMessages: messages
        .filter((message) => message.stream === "display")
        .map(restoreMessage),
      modelMessages: messages
        .filter((message) => message.stream === "model")
        .map(restoreMessage)
    };
  }

  saveMessages(userId, id, input) {
    if (!this.repository.find(userId, id)) {
      throw new HttpError(404, "CONVERSATION_NOT_FOUND", "未找到指定会话。");
    }
    const messages = Array.isArray(input.messages)
      ? input.messages.slice(0, 200).map(normalizeMessage)
      : [];
    if (!messages.length) return { saved: 0 };
    this.repository.upsertMessages(id, messages);
    return { saved: messages.length };
  }

  delete(userId, id) {
    if (!this.repository.delete(userId, id)) {
      throw new HttpError(404, "CONVERSATION_NOT_FOUND", "未找到指定会话。");
    }
  }
}

function normalizeMessage(message) {
  const id = String(message.id || "").trim().slice(0, 200);
  if (!id) throw new HttpError(400, "INVALID_MESSAGE_ID", "消息 ID 不能为空。");
  const stream = message.stream === "model" ? "model" : "display";
  const role = String(message.role || "user").slice(0, 40);
  const content =
    message.content === null
      ? null
      : String(message.content || "").slice(0, 100_000);
  const payload =
    message.payload && typeof message.payload === "object"
      ? message.payload
      : {};
  return {
    id,
    stream,
    position: Math.max(0, Number(message.position) || 0),
    role,
    content,
    payload,
    createdAt: Number(message.createdAt) || Date.now()
  };
}

function restoreMessage(message) {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    ...message.payload
  };
}

function boundedInteger(value, fallback, maximum) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(maximum, parsed)
    : fallback;
}

function nonNegativeInteger(value) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

module.exports = { ConversationService };
