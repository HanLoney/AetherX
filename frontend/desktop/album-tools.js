(function exposeAlbumTools(global) {
  const objectSchema = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
  const stringField = (description) => ({ type: "string", description });

  function registerAlbumTools(registry) {
    registry.register({
      name: "album.search_sources",
      title: "读取纪念素材",
      description:
        "读取最近共同记忆、手记、心情事件和长期记忆，作为书写纪念卡的真实来源。写纪念卡前应先调用。",
      risk: "read",
      inputSchema: objectSchema({
        since: {
          type: "number",
          description: "可选，毫秒时间戳，只读取此时间后的素材"
        },
        limit: {
          type: "number",
          description: "返回数量，默认 20，最大 100"
        }
      }),
      async execute(input) {
        try {
          const sources = await global.desktop.listAlbumSourceCandidates({
            since: input.since,
            limit: Math.max(1, Math.min(100, Number(input.limit) || 20))
          });
          return {
            ok: true,
            content: `找到 ${sources.length} 条可写入纪念册的真实素材。`,
            data: sources
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "album.list_moments",
      title: "查看纪念册",
      description:
        "查看已经写入我们的纪念册的纪念卡。用户问过去的重要时刻、纪念册里有什么时使用。",
      risk: "read",
      inputSchema: objectSchema({
        q: stringField("可选搜索关键词"),
        status: {
          type: "string",
          enum: ["candidate", "active", "hidden"],
          description: "可选状态"
        },
        limit: {
          type: "number",
          description: "返回数量，默认 20"
        }
      }),
      async execute(input) {
        try {
          const moments = await global.desktop.listAlbumMoments(input);
          return {
            ok: true,
            content: `纪念册里找到 ${moments.length} 张纪念卡。`,
            data: moments
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "album.create_moment",
      title: "写入纪念册",
      description:
        "基于真实来源，以小玄自己的口吻写一张纪念卡。必须基于用户共同经历、手记、心情事件或聊天证据，不要凭空编造。",
      risk: "write",
      inputSchema: objectSchema(
        {
          occurredAt: {
            type: "number",
            description: "纪念时刻发生时间，毫秒时间戳"
          },
          title: stringField("纪念卡标题"),
          summary: stringField("短摘要"),
          detail: stringField("小玄以第一人称或亲密旁白写下的完整纪念文字"),
          mood: stringField("这一刻的心情"),
          tags: {
            type: "array",
            description: "标签数组"
          },
          importance: {
            type: "number",
            description: "重要程度，0 到 1"
          },
          status: {
            type: "string",
            enum: ["candidate", "active"],
            description: "默认 active"
          },
          sources: {
            type: "array",
            description:
              "来源数组，每项含 sourceType、sourceId、sourceExcerpt、weight"
          }
        },
        ["title", "summary"]
      ),
      async execute(input) {
        try {
          const moment = await global.desktop.createAlbumMoment({
            ...input,
            status: input.status || "active"
          });
          return {
            ok: true,
            content: `已经写入纪念册：《${moment.title}》。`,
            data: moment
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "album.attach_sources",
      title: "绑定纪念来源",
      description: "给已有纪念卡追加真实来源证据。",
      risk: "write",
      inputSchema: objectSchema(
        {
          momentId: stringField("纪念卡 ID"),
          sourceType: {
            type: "string",
            enum: [
              "shared_memory",
              "journal",
              "mood_event",
              "conversation_message",
              "memory",
              "manual"
            ]
          },
          sourceId: stringField("来源 ID"),
          sourceExcerpt: stringField("来源摘录"),
          weight: {
            type: "number",
            description: "来源权重，0 到 1"
          }
        },
        ["momentId", "sourceType", "sourceId"]
      ),
      async execute(input) {
        try {
          const moment = await global.desktop.addAlbumMomentSource(
            input.momentId,
            input
          );
          return {
            ok: true,
            content: `已经给《${moment.title}》补充来源。`,
            data: moment
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "album.update_moment",
      title: "修改纪念卡",
      description: "润色、补充、隐藏或修正已有纪念卡。",
      risk: "write",
      inputSchema: objectSchema(
        {
          id: stringField("纪念卡 ID"),
          title: stringField("标题"),
          summary: stringField("摘要"),
          detail: stringField("完整文字"),
          mood: stringField("心情"),
          status: {
            type: "string",
            enum: ["candidate", "active", "hidden"]
          }
        },
        ["id"]
      ),
      async execute(input) {
        try {
          const { id, ...changes } = input;
          const moment = await global.desktop.updateAlbumMoment(id, changes);
          return {
            ok: true,
            content: `已经更新纪念卡：《${moment.title}》。`,
            data: moment
          };
        } catch (error) {
          return failure(error);
        }
      }
    });
    return registry;
  }

  function failure(error) {
    const message = error?.message || "纪念册服务请求失败。";
    return {
      ok: false,
      content: message,
      error: { code: error?.code || "ALBUM_API_ERROR", message }
    };
  }

  global.registerAlbumTools = registerAlbumTools;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { registerAlbumTools };
  }
})(typeof window === "undefined" ? globalThis : window);
