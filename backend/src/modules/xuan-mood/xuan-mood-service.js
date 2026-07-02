const { HttpError } = require("../../lib/http-error");

const SOURCE_TYPES = new Set(["chat", "journal", "shared_experience"]);
const TONES = new Set([
  "calm",
  "clingy",
  "focused",
  "tired",
  "happy",
  "worried",
  "quiet"
]);

class XuanMoodService {
  constructor({ repository, configRepository, providerClient }) {
    this.repository = repository;
    this.configRepository = configRepository;
    this.providerClient = providerClient;
  }

  async getHome(userId) {
    const display = this.repository.getLatestDisplay(userId);
    const events = this.repository.listRecentEvents(userId, 6);
    if (events.length && (!display || display.expiresAt <= Date.now())) {
      await this.refresh(userId).catch(() => null);
    }
    return this.snapshot(userId);
  }

  async recordEvent(userId, input = {}) {
    const source = normalizeSource(input);
    const generated = await this.generate(userId, source).catch(() => null);
    const event = this.repository.createEvent(userId, {
      sourceType: source.sourceType,
      sourceId: source.sourceId,
      sourceCreatedAt: source.sourceCreatedAt,
      summary:
        cleanText(generated?.event?.summary, 500) ||
        cleanText(source.summary, 500) ||
        sourceFallbackSummary(source),
      emotionalTone: cleanText(generated?.event?.emotionalTone, 120),
      effectOnXuan: cleanText(generated?.event?.effectOnXuan, 500),
      intensity: normalizeIntensity(generated?.event?.intensity),
      rawPayload: source.payload
    });
    if (generated?.state) {
      this.repository.saveState(userId, generated.state);
    }
    if (generated?.display) {
      const display = safeDisplay(generated.display, [event.id]);
      if (display) this.repository.saveDisplay(userId, display);
    }
    return {
      event,
      ...this.snapshot(userId)
    };
  }

  async refresh(userId) {
    const generated = await this.generate(userId, null);
    if (generated?.state) {
      this.repository.saveState(userId, generated.state);
    }
    if (generated?.display) {
      const eventIds = this.repository
        .listRecentEvents(userId, 6)
        .map((event) => event.id);
      const display = safeDisplay(generated.display, eventIds);
      if (display) this.repository.saveDisplay(userId, display);
    }
    return this.snapshot(userId);
  }

  snapshot(userId) {
    return {
      state: this.repository.getState(userId),
      display: this.repository.getLatestDisplay(userId),
      recentEvents: this.repository.listRecentEvents(userId, 6)
    };
  }

  async generate(userId, source) {
    const config = this.configRepository.getCredentials(userId);
    if (!config.apiKey) return null;
    const current = this.repository.getState(userId);
    const recentEvents = this.repository.listRecentEvents(userId, 12);
    if (!source && !recentEvents.length) return null;

    const result = await this.providerClient.chat(config, {
      messages: [
        {
          role: "system",
          content: [
            "你是“小玄”的心情模块，不是聊天回复助手。",
            "你只根据给定事件、当前状态和最近经历更新她的心情、精力与关注点。",
            "不要使用固定模板，不要输出数值，不要机械地按一句话加减状态。",
            "不得编造给定资料之外的重大事件；可以表达细腻感受，但不要病娇、控制、PUA 或强依赖。",
            "首页展示要像亲密伙伴自然流露出的状态，不像系统通知，不提“我是 AI”。",
            "只输出 JSON，不要 Markdown，不要解释。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            outputShape: {
              event: {
                summary: "这次事件的简短事实摘要",
                emotionalTone: "自然语言描述情绪氛围",
                effectOnXuan: "这件事如何影响小玄",
                intensity: "low | medium | high"
              },
              state: {
                currentMood: "小玄现在的心情",
                energy: "她现在的精力状态",
                attention: "她的注意力落在哪里",
                reason: "状态来自哪些经历",
                focus: "当前在意的事",
                continuity: "与之前状态的连续性"
              },
              display: {
                title: "2到8个字",
                line: "主页一句话，不要像模板",
                detail: "更细的一段状态说明",
                focus: "她现在在意的事情",
                tone: "calm | clingy | focused | tired | happy | worried | quiet",
                expiresInMinutes: 15
              }
            },
            currentState: current?.state || null,
            recentEvents,
            newSource: source
          })
        }
      ],
      tools: []
    });
    if (!result?.ok) return null;
    return normalizeGenerated(parseJsonObject(extractText(result.data)));
  }
}

function normalizeSource(input) {
  const sourceType = String(input.sourceType || "").trim();
  if (!SOURCE_TYPES.has(sourceType)) {
    throw new HttpError(400, "INVALID_MOOD_SOURCE", "心情事件来源不正确。");
  }
  const sourceCreatedAt = timestamp(input.sourceCreatedAt) || Date.now();
  const payload = {
    userMessage: cleanText(input.userMessage, 4000),
    assistantMessage: cleanText(input.assistantMessage, 4000),
    title: cleanText(input.title, 200),
    content: cleanText(input.content, 6000),
    mood: cleanText(input.mood, 100),
    summary: cleanText(input.summary, 1000),
    conversationMessages: Array.isArray(input.conversationMessages)
      ? input.conversationMessages.slice(-12).map((message) => ({
          role: ["user", "assistant"].includes(message?.role)
            ? message.role
            : "user",
          content: cleanText(message?.content, 2000)
        }))
      : []
  };
  return {
    sourceType,
    sourceId: cleanText(input.sourceId, 120),
    sourceCreatedAt,
    summary: payload.summary,
    payload
  };
}

function normalizeGenerated(value) {
  if (!value || typeof value !== "object") return null;
  return {
    event: value.event && typeof value.event === "object" ? value.event : null,
    state: value.state && typeof value.state === "object" ? value.state : null,
    display:
      value.display && typeof value.display === "object" ? value.display : null
  };
}

function normalizeDisplay(display, eventIds) {
  const expiresInMinutes = Math.max(
    10,
    Math.min(180, Number(display.expiresInMinutes) || 30)
  );
  const title = cleanText(display.title, 24);
  const line = cleanText(display.line, 180);
  if (!title || !line) {
    throw new HttpError(502, "INVALID_MOOD_DISPLAY", "模型没有生成可展示心情。");
  }
  const tone = String(display.tone || "quiet").trim();
  return {
    title,
    line,
    detail: cleanText(display.detail, 600),
    focus: cleanText(display.focus, 120),
    tone: TONES.has(tone) ? tone : "quiet",
    basedOnEventIds: eventIds,
    expiresAt: Date.now() + expiresInMinutes * 60_000
  };
}

function safeDisplay(display, eventIds) {
  try {
    return normalizeDisplay(display, eventIds);
  } catch {
    return null;
  }
}

function sourceFallbackSummary(source) {
  if (source.sourceType === "journal") {
    return source.payload.title || "小玄写下了一篇新的手记。";
  }
  if (source.sourceType === "shared_experience") {
    return source.payload.summary || "洛尼和小玄新增了一段共同经历。";
  }
  return "洛尼和小玄完成了一轮新的对话。";
}

function normalizeIntensity(value) {
  const text = String(value || "").trim();
  return ["low", "medium", "high"].includes(text) ? text : "medium";
}

function extractText(data) {
  const choice = data?.choices?.[0];
  const message = choice?.message || choice?.delta || {};
  const content = message.content;
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === "string" ? part : part?.text || part?.content || ""
      )
      .join("")
      .trim();
  }
  if (typeof data?.output_text === "string") return data.output_text.trim();
  return "";
}

function parseJsonObject(text) {
  const value = String(text || "").trim();
  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

function cleanText(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function timestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

module.exports = { XuanMoodService };
