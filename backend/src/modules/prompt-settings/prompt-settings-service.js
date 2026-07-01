const { HttpError } = require("../../lib/http-error");

const DEFAULTS = Object.freeze({
  tone: "亲密、自然、清晰",
  responseLength: "balanced",
  initiative: 0.75,
  humor: 0.45,
  useEmoji: true,
  behaviorRules: [
    "先理解用户真正想解决的问题，再采取行动",
    "涉及事实和代码时先验证，不确定时明确说明",
    "完成任务后简洁说明结果和需要用户知道的限制"
  ],
  workInstruction: "像可靠的协作者一样推进任务，重视可维护性、验证和清晰交付。",
  lifeInstruction: "兼顾实用性与关心，不把生活问题强行转换成工作任务。",
  emotionalInstruction: "先理解和陪伴，再判断用户是否需要建议或行动。",
  prohibitedBehaviors: [],
  customInstruction: ""
});

class PromptSettingsService {
  constructor(repository, composer, assistantMemoryService) {
    this.repository = repository;
    this.composer = composer;
    this.assistantMemoryService = assistantMemoryService;
  }

  getBundle(userId) {
    const saved = this.repository.get(userId);
    const settings = normalize(saved?.settings || DEFAULTS);
    return this.bundle(
      userId,
      settings,
      saved?.version || 0,
      saved?.updatedAt || null
    );
  }

  save(userId, input) {
    const current = this.getBundle(userId).settings;
    const saved = this.repository.save(userId, normalize({ ...current, ...input }));
    return this.bundle(userId, saved.settings, saved.version, saved.updatedAt);
  }

  listVersions(userId) {
    return this.repository.listVersions(userId).map((item) => ({
      version: item.version,
      createdAt: item.createdAt
    }));
  }

  restore(userId, version) {
    const target = this.repository.findVersion(userId, Number(version));
    if (!target) {
      throw new HttpError(404, "PROMPT_VERSION_NOT_FOUND", "未找到提示词版本。");
    }
    return this.save(userId, target.settings);
  }

  bundle(userId, settings, version, updatedAt) {
    const profile = this.assistantMemoryService.getProfile(userId);
    const composed = this.composer.compose(settings, profile);
    return { settings, version, updatedAt, ...composed };
  }
}

function normalize(input) {
  return {
    tone: text(input.tone, 300) || DEFAULTS.tone,
    responseLength: ["concise", "balanced", "detailed"].includes(
      input.responseLength
    )
      ? input.responseLength
      : DEFAULTS.responseLength,
    initiative: clamp(input.initiative, DEFAULTS.initiative),
    humor: clamp(input.humor, DEFAULTS.humor),
    useEmoji:
      typeof input.useEmoji === "boolean" ? input.useEmoji : DEFAULTS.useEmoji,
    behaviorRules: stringList(
      input.behaviorRules,
      DEFAULTS.behaviorRules,
      20,
      500
    ),
    workInstruction: text(input.workInstruction, 2000),
    lifeInstruction: text(input.lifeInstruction, 2000),
    emotionalInstruction: text(input.emotionalInstruction, 2000),
    prohibitedBehaviors: stringList(
      input.prohibitedBehaviors,
      [],
      20,
      500
    ),
    customInstruction: text(input.customInstruction, 4000)
  };
}

function text(value, maxLength) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function clamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(0, Math.min(1, number))
    : fallback;
}

function stringList(value, fallback, limit, maxLength) {
  if (!Array.isArray(value)) return [...fallback];
  return value
    .slice(0, limit)
    .map((item) => text(item, maxLength))
    .filter(Boolean);
}

module.exports = { PromptSettingsService, DEFAULTS };
