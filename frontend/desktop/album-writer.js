(function exposeAlbumWriter(global) {
  class XuanAlbumWriter {
    constructor(options) {
      this.isEnabled = options.isEnabled;
      this.getConfig = options.getConfig;
      this.requestAI = options.requestAI;
      this.createMoment = options.createMoment;
      this.getUserName = options.getUserName || (() => "洛尼");
      this.getAssistantName = options.getAssistantName || (() => "小玄");
    }

    async writeFromSharedMemories(sharedMemories = []) {
      if (!this.isEnabled() || !sharedMemories.length) return null;
      const config = this.getConfig();
      if (!config?.hasApiKey) return null;
      const userName = text(this.getUserName(), 40) || "洛尼";
      const assistantName = text(this.getAssistantName(), 40) || "小玄";
      const sources = sharedMemories
        .filter((item) => item?.id && item?.content)
        .slice(0, 5)
        .map((item) => ({
          sourceType: "shared_memory",
          sourceId: item.id,
          sourceExcerpt: personalizeRoles(
            item.content,
            userName,
            assistantName
          ),
          weight: Math.max(0.5, Math.min(1, Number(item.importance) || 0.75))
        }));
      if (!sources.length) return null;
      const prompt = [
        `你是${assistantName}的纪念册书写模块。请基于真实来源，以${assistantName}自己的感受写一张纪念卡。`,
        `用户的名字是${userName}，助手的名字是${assistantName}。成文必须直接使用名字，严禁用“用户”“助手”代称他们。`,
        "不要写成系统总结，不要编造来源之外的经历；可以有温柔、亲密、主观的表达。",
        '只输出 JSON：{"title":"标题","summary":"短摘要","detail":"完整纪念文字","mood":"心情","tags":["标签"],"importance":0到1}。'
      ].join("\n");
      const result = await this.requestAI({
        ...config,
        messages: [
          { role: "system", content: prompt },
          {
            role: "user",
            content: `真实来源：\n${sources
              .map((source, index) => `${index + 1}. ${source.sourceExcerpt}`)
              .join("\n")}`
          }
        ],
        tools: []
      });
      const parsed = parseJsonObject(extractText(result?.data));
      if (!parsed?.title || !parsed?.summary) return null;
      return this.createMoment({
        occurredAt: Date.now(),
        title: text(parsed.title, 80),
        summary: text(parsed.summary, 500),
        detail: text(parsed.detail, 5000),
        mood: text(parsed.mood, 80),
        tags: Array.isArray(parsed.tags)
          ? parsed.tags.map((item) => text(item, 30)).filter(Boolean).slice(0, 8)
          : [],
        importance: Math.max(0, Math.min(1, Number(parsed.importance) || 0.75)),
        status: "active",
        sources
      });
    }
  }

  function extractText(data) {
    const message = data?.choices?.[0]?.message || data?.choices?.[0]?.delta || {};
    const content = message.content ?? data?.output_text ?? "";
    if (typeof content === "string") return content.trim();
    if (Array.isArray(content)) {
      return content
        .map((part) =>
          typeof part === "string" ? part : part?.text || part?.content || ""
        )
        .join("")
        .trim();
    }
    return "";
  }

  function parseJsonObject(textValue) {
    const text = String(textValue || "").trim();
    try {
      return JSON.parse(text);
    } catch {
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) return null;
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
  }

  function text(value, limit) {
    return String(value || "").trim().slice(0, limit);
  }

  function personalizeRoles(value, userName, assistantName) {
    return String(value || "")
      .replaceAll("用户", "\uE000")
      .replaceAll("助手", "\uE001")
      .replaceAll("\uE000", userName)
      .replaceAll("\uE001", assistantName);
  }

  global.XuanAlbumWriter = XuanAlbumWriter;
  if (typeof module !== "undefined") {
    module.exports = { XuanAlbumWriter, personalizeRoles };
  }
})(typeof window === "undefined" ? globalThis : window);
