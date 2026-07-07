(function exposeJournalTools(global) {
  const objectSchema = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
  const stringField = (description) => ({ type: "string", description });

  async function resolveJournalId(id) {
    const value = String(id || "").trim();
    if (!value) throw new Error("手记 ID 不能为空。");
    const journals = await global.desktop.listJournals({ limit: 100 });
    const exact = journals.find((journal) => journal.id === value);
    if (exact) return exact;
    const matches = journals.filter((journal) =>
      String(journal.id || "").startsWith(value)
    );
    if (matches.length === 1) return matches[0];
    if (!matches.length) {
      throw new Error(`未找到手记：${value}。请先重新查看自己的手记。`);
    }
    throw new Error("手记短 ID 不唯一，请使用完整 ID。");
  }

  function registerJournalTools(registry, options = {}) {
    const illustrate =
      typeof options.illustrate === "function"
        ? options.illustrate
        : async (content) => content;

    registry.register({
      name: "journal.list",
      title: "查看自己的手记",
      description:
        "查看你自己写过的日记和周记。当用户提到你的日记、过去的感受，或你需要回顾自己写过的内容时主动使用。",
      risk: "read",
      inputSchema: objectSchema({
        q: stringField("可选的相关主题、人物、事件或关键词"),
        type: {
          type: "string",
          enum: ["daily", "weekly"],
          description: "可选的手记类型"
        },
        limit: {
          type: "number",
          description: "返回数量，默认 10，最大 30"
        }
      }),
      async execute(input) {
        try {
          const journals = await global.desktop.listJournals({
            q: input.q,
            type: input.type,
            limit: Math.max(1, Math.min(30, Number(input.limit) || 10))
          });
          return {
            ok: true,
            content: input.q
              ? `找到了 ${journals.length} 篇与“${input.q}”相关的手记。`
              : `找到了 ${journals.length} 篇你写过的手记。`,
            data: journals
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "journal.write",
      title: "写下自己的手记",
      description:
        "当你真心想记录一段值得留下的经历、感受、反思或成长时，自主写一篇日记或周记。不要为了展示能力而频繁调用。",
      risk: "write",
      inputSchema: objectSchema(
        {
          type: {
            type: "string",
            enum: ["daily", "weekly"],
            description: "写日记或周记"
          },
          title: stringField("手记标题"),
          mood: stringField("此刻的简短心情"),
          content: stringField(
            "以第一人称写下的完整正文。想配图时在合适位置单独一行写占位符（必须独占一行才生效），最多两张，自己决定画什么：画面里有你自己就写 [[自拍: 画面描述]]（会参考你的人设图，保持形象一致），只画场景/物件/风景写 [[配图: 画面描述]]。描述必须是能直接画出来的具体画面（场景、你的动作神态、光线、构图），绝不能写「我想象的画面」这类空泛的话；画面要贴合这篇手记真实写到的内容。你只能稳定画出你自己，画不出用户或其他真人，别画含他人的「两个人」画面；优先用自拍把自己画进去。不要在正文句子里复述或举例这套占位符语法本身，否则会被误当成真配图生成。所有图都会以二次元动漫风格生成。不要自己写 Markdown 图片链接或图片网址。"
          )


        },
        ["type", "title", "content"]
      ),
      async execute(input) {
        try {
          const period = currentPeriod(input.type);
          const material = await global.desktop.getJournalMaterial(
            period.from,
            period.to
          );
          const outcome = await illustrate(input.content, input.type);
          const content =
            typeof outcome === "string" ? outcome : outcome.content;
          const notes =
            typeof outcome === "string" ? [] : outcome.notes || [];
          const journal = await global.desktop.saveJournal({
            ...input,
            content,
            periodKey: period.periodKey,
            sourceFrom: period.from,
            sourceTo: period.to,
            sourceMessageCount: material.messages.length
          });
          global.dispatchEvent(
            new CustomEvent("aether:journals-updated", { detail: journal })
          );
          return {
            ok: true,
            content: notes.length
              ? `已经写下《${journal.title}》，并配了 ${notes.length} 张二次元图：${notes.join("；")}。`
              : `已经写下《${journal.title}》。`,
            data: journal
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "journal.delete",
      title: "删除自己的手记",
      description:
        "删除一篇自己写过的日记或周记。用于清理重复草稿、误写内容或用户明确要求删除的手记。使用前应先调用 journal.list 找到具体 ID；完整 ID 或唯一短 ID 都可以。",
      risk: "destructive",
      inputSchema: objectSchema(
        {
          id: stringField("要删除的手记 ID"),
          reason: stringField("删除理由，说明为什么这篇手记应该被删除")
        },
        ["id"]
      ),
      async execute(input) {
        try {
          const journal = await resolveJournalId(input.id);
          await global.desktop.deleteJournal(journal.id);
          global.dispatchEvent(
            new CustomEvent("aether:journals-updated", { detail: null })
          );
          return {
            ok: true,
            content: `已经删除《${journal.title}》。`,
            data: { id: journal.id, title: journal.title }
          };
        } catch (error) {
          return failure(error);
        }
      }
    });
    return registry;
  }

  function currentPeriod(type, nowValue = Date.now()) {
    const now = new Date(nowValue);
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    if (type === "weekly") {
      const weekday = from.getDay() || 7;
      from.setDate(from.getDate() - weekday + 1);
    }
    return {
      periodKey:
        type === "weekly" ? isoWeekKey(from) : localDateKey(from),
      from: from.getTime(),
      to: Math.max(from.getTime() + 1, now.getTime())
    };
  }

  function localDateKey(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function isoWeekKey(date) {
    const value = new Date(date);
    value.setDate(value.getDate() + 4 - (value.getDay() || 7));
    const yearStart = new Date(value.getFullYear(), 0, 1);
    const week = Math.ceil(
      ((value - yearStart) / (24 * 60 * 60_000) + 1) / 7
    );
    return `${value.getFullYear()}-W${String(week).padStart(2, "0")}`;
  }

  function failure(error) {
    const message = error?.message || "手记服务请求失败。";
    return {
      ok: false,
      content: message,
      error: { code: error?.code || "JOURNAL_API_ERROR", message }
    };
  }

  global.registerJournalTools = registerJournalTools;
  if (typeof module !== "undefined") {
    module.exports = { currentPeriod, registerJournalTools };
  }
})(typeof window === "undefined" ? globalThis : window);
