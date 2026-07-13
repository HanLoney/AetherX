const { HttpError } = require("../../lib/http-error");
const {
  isInvalidMemorySource,
  isLowValueConversation,
  isSystemFeedback
} = require("../memories/memory-content-policy");
const {
  expandQueryTerms,
  normalizeText,
  similarity
} = require("../memories/memory-text");
const {
  normalizeAvatarDataUrl,
  normalizePersonaImageDataUrl
} = require("../profiles/avatar-data");

class AssistantMemoryService {
  constructor(repository) {
    this.repository = repository;
  }

  getProfile(userId) {
    return this.repository.getProfile(userId);
  }

  saveProfile(userId, input) {
    const current = this.repository.getProfile(userId);
    return this.repository.saveProfile(userId, {
      name: text(input.name ?? current.name, 100),
      gender: text(input.gender ?? current.gender, 50),
      selfDefinition: text(
        input.selfDefinition ?? current.selfDefinition,
        1000
      ),
      relationshipSummary: text(
        input.relationshipSummary ?? current.relationshipSummary,
        1000
      ),
      traits: normalizeList(input.traits ?? current.traits, 30),
      values: normalizeList(input.values ?? current.values, 30),
      avatarDataUrl:
        input.avatarDataUrl === undefined
          ? current.avatarDataUrl
          : normalizeAvatarDataUrl(input.avatarDataUrl),
      personaImageDataUrl:
        input.personaImageDataUrl === undefined
          ? current.personaImageDataUrl
          : normalizePersonaImageDataUrl(input.personaImageDataUrl)
    });
  }

  listEvents(userId, query = {}) {
    const status = text(query.status, 30);
    return this.repository.listEvents(userId, status === "all" ? "" : status);
  }

  recordEvent(userId, input) {
    const content = text(input.content, 2000);
    if (!content) {
      throw new HttpError(400, "INVALID_PERSONALITY_EVENT", "人格事件不能为空。");
    }
    if (isLowValueConversation(`${content}\n${input.evidence || ""}`)) {
      return { duplicate: true, filtered: true, content };
    }
    const traitKey = text(input.traitKey, 100);
    const existing = this.listEvents(userId).find((event) => {
      if (normalizeText(event.content) === normalizeText(content)) return true;
      return Boolean(
        traitKey &&
        event.traitKey === traitKey &&
        similarity(event.content, content) >= 0.45
      );
    });
    if (existing) return { ...existing, duplicate: true };
    const event = this.repository.createEvent(userId, {
      category: text(input.category || "growth", 60),
      traitKey,
      traitValue: text(input.traitValue, 500),
      content,
      evidence: text(input.evidence, 1000),
      sourceRole: ["user", "assistant", "tool", "shared"].includes(
        input.sourceRole
      )
        ? input.sourceRole
        : "shared",
      confidence: clamp(input.confidence ?? 0.8),
      weight: clamp(input.weight ?? 0.5),
      status: input.status === "candidate" ? "candidate" : "active"
    });
    if (event.status === "active" && event.traitKey && event.traitValue) {
      this.applyTrait(userId, event);
    }
    return event;
  }

  deleteEvent(userId, id) {
    if (!this.repository.deleteEvent(userId, id)) {
      throw new HttpError(404, "PERSONALITY_EVENT_NOT_FOUND", "未找到人格事件。");
    }
  }

  confirmEvent(userId, id) {
    const current = this.listEvents(userId).find((event) => event.id === id);
    if (current?.status === "active") return current;
    const event = this.repository.confirmEvent(userId, id);
    if (!event) {
      throw new HttpError(404, "PERSONALITY_EVENT_NOT_FOUND", "未找到人格事件。");
    }
    if (event.traitKey && event.traitValue) this.applyTrait(userId, event);
    return event;
  }

  listSharedMemories(userId, query = {}) {
    const status = text(query.status, 30);
    return this.repository.listSharedMemories(
      userId,
      status === "all" ? "" : status
    );
  }

  createSharedMemory(userId, input) {
    const content = text(input.content, 5000);
    if (!content) {
      throw new HttpError(400, "INVALID_SHARED_MEMORY", "共同记忆不能为空。");
    }
    if (
      isSystemFeedback(content) ||
      isInvalidMemorySource(input.evidence)
    ) {
      throw new HttpError(
        400,
        "SYSTEM_FEEDBACK_NOT_MEMORY",
        "系统功能反馈不能保存为共同记忆。"
      );
    }
    if (isLowValueConversation(`${content}\n${input.evidence || ""}`)) {
      return { duplicate: true, filtered: true, content };
    }
    const type = text(input.type || "episode", 60);
    const existing = this.listSharedMemories(userId).find((memory) => {
      if (normalizeText(memory.content) === normalizeText(content)) return true;
      return memory.type === type && similarity(memory.content, content) >= 0.62;
    });
    if (existing) return { ...existing, duplicate: true };
    return this.repository.createSharedMemory(userId, {
      type,
      content,
      participants: normalizeStrings(
        input.participants || ["用户", this.getProfile(userId).name],
        20,
        100
      ),
      evidence: text(input.evidence, 1000),
      source: ["explicit", "inferred", "tool"].includes(input.source)
        ? input.source
        : "inferred",
      confidence: clamp(input.confidence ?? 0.8),
      importance: clamp(input.importance ?? 0.5),
      status: input.status === "candidate" ? "candidate" : "active"
    });
  }

  deleteSharedMemory(userId, id) {
    if (!this.repository.deleteSharedMemory(userId, id)) {
      throw new HttpError(404, "SHARED_MEMORY_NOT_FOUND", "未找到共同记忆。");
    }
  }

  confirmSharedMemory(userId, id) {
    const current = this.listSharedMemories(userId).find(
      (memory) => memory.id === id
    );
    if (current?.status === "active") return current;
    const memory = this.repository.confirmSharedMemory(userId, id);
    if (!memory) {
      throw new HttpError(404, "SHARED_MEMORY_NOT_FOUND", "未找到共同记忆。");
    }
    return memory;
  }

  recallSharedMemories(userId, query, limit = 4) {
    const terms = expandQueryTerms(query);
    const normalizedQuery = normalizeText(query);
    return this.listSharedMemories(userId, { status: "active" })
      .filter(
        (memory) =>
          !isSystemFeedback(memory.content) &&
          !isInvalidMemorySource(memory.evidence)
      )
      .map((memory) => {
        const content = normalizeText(memory.content);
        const matches = terms.filter((term) => content.includes(term)).length;
        const relevance = normalizedQuery.length >= 2 && content.includes(normalizedQuery)
          ? 6
          : matches >= 2
            ? Math.min(matches, 10)
            : 0;
        return { memory, score: relevance + memory.importance * 2 };
      })
      .filter(({ memory, score }) => score > memory.importance * 2 || memory.importance >= 0.9)
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(({ memory }) => memory);
  }

  context(userId, sharedMemories) {
    const profile = this.getProfile(userId);
    const shared = Array.isArray(sharedMemories)
      ? sharedMemories
      : this.listSharedMemories(userId, { status: "active" })
          .filter(
            (memory) =>
              !isSystemFeedback(memory.content) &&
              !isInvalidMemorySource(memory.evidence)
          )
          .slice(0, 6);
    const lines = [
      `[当前人格画像]`,
      profile.name && `名字：${profile.name}`,
      profile.gender && `性别认同：${profile.gender}`,
      profile.selfDefinition && `自我定位：${profile.selfDefinition}`,
      profile.relationshipSummary && `与用户的关系：${profile.relationshipSummary}`,
      profile.traits.length &&
        `当前性格特征：${profile.traits
          .map((item) => `${item.key}=${item.value}`)
          .join("；")}`,
      profile.values.length &&
        `当前价值倾向：${profile.values
          .map((item) => `${item.key}=${item.value}`)
          .join("；")}`
    ].filter(Boolean);
    if (shared.length) {
      lines.push(`[共同记忆]\n${shared.map((item) => `- ${item.content}`).join("\n")}`);
    }
    return lines.length > 1 ? lines.join("\n") : "";
  }

  applyTrait(userId, event) {
    const profile = this.getProfile(userId);
    if (event.traitKey.startsWith("identity.")) {
      const field = event.traitKey.slice("identity.".length);
      if (["name", "gender", "selfDefinition", "relationshipSummary"].includes(field)) {
        this.saveProfile(userId, { [field]: event.traitValue });
      }
      return;
    }
    const previous = profile.traits.find(
      (item) => item.key === event.traitKey
    );
    const previousCount = previous?.evidenceCount || 0;
    const traits = profile.traits.filter((item) => item.key !== event.traitKey);
    traits.push({
      key: event.traitKey,
      value: event.traitValue,
      strength:
        ((previous?.strength || 0) * previousCount + event.weight) /
        (previousCount + 1),
      evidenceCount: previousCount + 1,
      updatedAt: Date.now()
    });
    this.saveProfile(userId, { ...profile, traits });
  }
}

function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

function normalizeList(value, limit) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, limit).map((item) => {
    if (typeof item === "string") return { key: item, value: "" };
    return {
      key: text(item?.key, 100),
      value: text(item?.value, 500),
      strength: clamp(item?.strength ?? 0.5),
      evidenceCount: Math.max(0, Number(item?.evidenceCount) || 0),
      updatedAt: Number(item?.updatedAt) || Date.now()
    };
  }).filter((item) => item.key);
}

function normalizeStrings(value, limit, maxLength) {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, limit)
    .map((item) => text(item, maxLength))
    .filter(Boolean);
}

module.exports = { AssistantMemoryService };
