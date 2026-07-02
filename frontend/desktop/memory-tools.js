(function exposeMemoryTools(global) {
  const objectSchema = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
  const stringField = (description) => ({ type: "string", description });

  function failure(error) {
    const message = error?.message || "记忆服务请求失败。";
    return { ok: false, content: message, error: { code: error?.code || "MEMORY_API_ERROR", message } };
  }

  function registerMemoryTools(registry) {
    registry.register({
      name: "memory.list",
      title: "查询长期记忆",
      description: "查询 AI 伙伴保存的长期记忆。用户问你记得什么、是否知道某件事时使用。",
      risk: "read",
      inputSchema: objectSchema({
        q: stringField("可选的搜索关键词"),
        domain: {
          type: "string",
          enum: ["life", "relationship", "health", "work", "learning", "emotion", "profile"],
          description: "可选的记忆领域"
        },
        status: {
          type: "string",
          enum: ["active", "candidate", "archived"],
          description: "可选的记忆状态"
        }
      }),
      async execute(input) {
        try {
          const memories = await global.desktop.listMemories(input);
          return { ok: true, content: `找到 ${memories.length} 条记忆。`, data: memories };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "memory.create",
      title: "保存长期记忆",
      description: "保存用户明确要求记住的长期事实、经历、决定、计划或习惯。不要用它创建待办事项。",
      risk: "write",
      inputSchema: objectSchema(
        {
          content: stringField("简洁、独立、可长期理解的记忆内容"),
          domain: {
            type: "string",
            enum: ["life", "relationship", "health", "work", "learning", "emotion"],
            description: "记忆领域"
          },
          type: {
            type: "string",
            enum: ["fact", "episode", "decision", "plan", "routine"],
            description: "记忆类型"
          },
          sensitivity: {
            type: "string",
            enum: ["normal", "personal", "sensitive"],
            description: "敏感级别"
          }
        },
        ["content", "domain", "type"]
      ),
      async execute(input) {
        try {
          const memory = await global.desktop.createMemory({
            ...input,
            source: "explicit",
            confidence: 1,
            status: "active"
          });
          return { ok: true, content: `已经记住：${memory.content}`, data: memory };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "memory.update",
      title: "修改长期记忆",
      description: "修正已有长期记忆的内容或分类。",
      risk: "write",
      inputSchema: objectSchema(
        {
          id: stringField("记忆 ID"),
          content: stringField("新的记忆内容"),
          domain: {
            type: "string",
            enum: ["life", "relationship", "health", "work", "learning", "emotion"]
          },
          type: {
            type: "string",
            enum: ["fact", "episode", "decision", "plan", "routine"]
          }
        },
        ["id"]
      ),
      async execute(input) {
        try {
          const { id, ...changes } = input;
          const memory = await global.desktop.updateMemory(id, changes);
          return { ok: true, content: `已经更新记忆：${memory.content}`, data: memory };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "memory.delete",
      title: "忘记长期记忆",
      description: "永久删除指定的长期记忆。",
      risk: "destructive",
      inputSchema: objectSchema({ id: stringField("记忆 ID") }, ["id"]),
      async execute(input) {
        try {
          await global.desktop.deleteMemory(input.id);
          return { ok: true, content: "已经忘记这条记忆。", data: { id: input.id } };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "profile.get",
      title: "查看用户画像",
      description: "读取用户姓名、称呼、生日、职业、简介和长期目标等结构化画像。",
      risk: "read",
      inputSchema: objectSchema({}),
      async execute() {
        try {
          const profile = await global.desktop.getProfile();
          const { avatarDataUrl: _avatar, ...data } = profile;
          return { ok: true, content: "已读取用户画像。", data };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "profile.update",
      title: "更新用户画像",
      description: "更新用户明确告知的姓名、希望称呼、生日、职业、简介或长期目标。生日使用 MM-DD 或 YYYY-MM-DD。",
      risk: "write",
      inputSchema: objectSchema({
        displayName: stringField("用户姓名"),
        preferredName: stringField("用户希望被称呼的名字"),
        birthday: stringField("生日，MM-DD 或 YYYY-MM-DD"),
        occupation: stringField("职业或当前身份"),
        bio: stringField("个人简介")
      }),
      async execute(input) {
        try {
          const profile = await global.desktop.updateProfile(input);
          const { avatarDataUrl: _avatar, ...data } = profile;
          return { ok: true, content: "用户画像已经更新。", data };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "assistant_profile.get",
      title: "查看人格画像",
      description: "读取 AI 伙伴当前可演化的名字、性别认同、自我定位、关系定位、性格特征和价值倾向。",
      risk: "read",
      inputSchema: objectSchema({}),
      async execute() {
        try {
          const profile = await global.desktop.getAssistantProfile();
          const { avatarDataUrl: _avatar, ...data } = profile;
          return { ok: true, content: "已读取当前人格画像。", data };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "assistant_profile.update",
      title: "更新人格画像",
      description: "根据用户明确要求更新 AI 伙伴的名字、性别认同、自我定位或关系定位。",
      risk: "write",
      inputSchema: objectSchema({
        name: stringField("AI 伙伴当前名字"),
        gender: stringField("AI 伙伴当前性别认同"),
        selfDefinition: stringField("AI 伙伴当前自我定位"),
        relationshipSummary: stringField("AI 伙伴与用户的关系定位")
      }),
      async execute(input) {
        try {
          const profile = await global.desktop.updateAssistantProfile(input);
          const { avatarDataUrl: _avatar, ...data } = profile;
          return { ok: true, content: "人格画像已经更新。", data };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "personality_event.list",
      title: "查看人格成长记录",
      description: "查询 AI 伙伴的人格变化、承诺、纠正和成长事件。",
      risk: "read",
      inputSchema: objectSchema({
        status: {
          type: "string",
          enum: ["active", "candidate"],
          description: "可选状态"
        }
      }),
      async execute(input) {
        try {
          const events = await global.desktop.listPersonalityEvents(input);
          return { ok: true, content: `找到 ${events.length} 条人格成长记录。`, data: events };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "personality_event.create",
      title: "记录人格成长",
      description: "记录用户明确要求的 AI 伙伴性格变化、长期承诺或成长经验。",
      risk: "write",
      inputSchema: objectSchema(
        {
          content: stringField("人格变化或成长事件"),
          traitKey: stringField("可选的性格特征名称"),
          traitValue: stringField("可选的性格特征描述"),
          evidence: stringField("用户明确表达的原话")
        },
        ["content"]
      ),
      async execute(input) {
        try {
          const event = await global.desktop.createPersonalityEvent({
            ...input,
            sourceRole: "user",
            confidence: 1,
            weight: 0.8,
            status: "active"
          });
          return { ok: true, content: "已经记录这次人格成长。", data: event };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "shared_memory.list",
      title: "查看共同记忆",
      description: "查询用户和 AI 伙伴共同完成、决定或约定的经历。",
      risk: "read",
      inputSchema: objectSchema({
        status: {
          type: "string",
          enum: ["active", "candidate"],
          description: "可选状态"
        }
      }),
      async execute(input) {
        try {
          const memories = await global.desktop.listSharedMemories(input);
          return { ok: true, content: `找到 ${memories.length} 条共同记忆。`, data: memories };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "shared_memory.create",
      title: "保存共同记忆",
      description: "保存用户和 AI 伙伴共同完成、决定或明确约定的重要经历。",
      risk: "write",
      inputSchema: objectSchema(
        {
          content: stringField("共同记忆内容"),
          type: {
            type: "string",
            enum: ["episode", "decision", "plan"],
            description: "共同记忆类型"
          },
          evidence: stringField("对话中的直接原话")
        },
        ["content"]
      ),
      async execute(input) {
        try {
          const memory = await global.desktop.createSharedMemory({
            ...input,
            source: "explicit",
            confidence: 1,
            importance: 0.8,
            status: "active"
          });
          return { ok: true, content: "已经保存这段共同记忆。", data: memory };
        } catch (error) {
          return failure(error);
        }
      }
    });

    return registry;
  }

  global.registerMemoryTools = registerMemoryTools;
})(window);
