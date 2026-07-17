(function exposeDreamTools(global) {
  const objectSchema = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
  const stringField = (description) => ({ type: "string", description });

  async function resolveDreamId(id) {
    const value = String(id || "").trim();
    if (!value) throw new Error("梦境 ID 不能为空。");
    const dreams = await global.desktop.listDreams({ status: "all", limit: 100 });
    const exact = dreams.find((dream) => dream.id === value);
    if (exact) return exact;
    const matches = dreams.filter((dream) => String(dream.id || "").startsWith(value));
    if (matches.length === 1) return matches[0];
    if (!matches.length) throw new Error(`未找到梦境：${value}。请先查看梦境。`);
    throw new Error("梦境短 ID 不唯一，请使用完整 ID。");
  }

  function registerDreamTools(registry) {
    registry.register({
      name: "dream.list",
      title: "查看梦境",
      description:
        "查看已经写下的梦境。梦境是明确标记的虚构内容，只能作为想象性记录，不可当作现实记忆或事实证据。",
      risk: "read",
      inputSchema: objectSchema({
        q: stringField("可选搜索关键词"),
        status: {
          type: "string",
          enum: ["active", "archived", "all"],
          description: "可选状态"
        },
        limit: {
          type: "number",
          description: "返回数量，默认 20，最大 50"
        }
      }),
      async execute(input) {
        try {
          const dreams = await global.desktop.listDreams({
            q: input.q,
            status: input.status,
            limit: Math.max(1, Math.min(50, Number(input.limit) || 20))
          });
          return {
            ok: true,
            content: `找到了 ${dreams.length} 段梦境。梦境均为虚构记录，不代表现实发生。`,
            data: dreams
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "dream.write",
      title: "写下梦境",
      description:
        "写一段明确标记为梦的虚构梦境。可以被聊天、手记、记忆和心情激发，但不必逐条遵循来源；梦可以发散、象征化、跳跃和错位。必须保持小玄的人设口吻，并明确说明它不是现实记录。",
      risk: "write",
      inputSchema: objectSchema(
        {
          dreamDate: stringField("梦境日期，YYYY-MM-DD"),
          title: stringField("梦境标题"),
          mood: stringField("梦醒后的心情"),
          content: stringField("以第一人称写下的梦境正文，必须明确它是梦"),
          symbols: {
            type: "array",
            description: "梦里的意象标签"
          },
          realityNote: stringField("现实边界说明，说明这是虚构梦境"),
          sourceFrom: { type: "number", description: "灵感素材开始时间戳" },
          sourceTo: { type: "number", description: "灵感素材结束时间戳" },
          sources: {
            type: "array",
            description:
              "灵感来源数组，每项含 sourceType、sourceId、sourceExcerpt、weight；来源只表示触发灵感，不要求梦境逐字对应"
          }
        },
        ["dreamDate", "title", "content", "sourceFrom", "sourceTo"]
      ),
      async execute(input) {
        try {
          const dream = await global.desktop.createDream({
            ...input,
            status: "active"
          });
          global.dispatchEvent(new CustomEvent("aether:dreams-updated", { detail: dream }));
          return {
            ok: true,
            content: `已经写下梦境《${dream.title}》。它是虚构梦，不是现实记忆。`,
            data: dream
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "dream.delete",
      title: "删除梦境",
      description: "删除一段梦境。用于清理重复、误写或用户明确要求删除的梦境。",
      risk: "destructive",
      inputSchema: objectSchema(
        {
          id: stringField("要删除的梦境 ID"),
          reason: stringField("删除理由")
        },
        ["id"]
      ),
      async execute(input) {
        try {
          const dream = await resolveDreamId(input.id);
          await global.desktop.deleteDream(dream.id);
          global.dispatchEvent(new CustomEvent("aether:dreams-updated", { detail: null }));
          return {
            ok: true,
            content: `已经删除梦境《${dream.title}》。`,
            data: { id: dream.id, title: dream.title }
          };
        } catch (error) {
          return failure(error);
        }
      }
    });
    return registry;
  }

  function failure(error) {
    const message = error?.message || "梦境服务请求失败。";
    return {
      ok: false,
      content: message,
      error: { code: error?.code || "DREAM_API_ERROR", message }
    };
  }

  global.registerDreamTools = registerDreamTools;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { registerDreamTools };
  }
})(typeof window === "undefined" ? globalThis : window);
