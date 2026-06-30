const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createApp } = require("../src/app");
const {
  MemoryIntelligenceService
} = require("../src/modules/memories/memory-intelligence-service");

async function withServer(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "xuanai-test-"));
  const app = createApp({
    host: "127.0.0.1",
    port: 0,
    dataDir,
    masterKey: "test-master-key",
    corsOrigin: "*"
  });
  const address = await app.listen();
  try {
    await run(`http://127.0.0.1:${address.port}`, dataDir);
  } finally {
    await app.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function request(baseUrl, method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Xuan-User-Id": "test-user"
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = response.status === 204 ? null : await response.json();
  return { response, payload };
}

test("health endpoint reports readiness", async () => {
  await withServer(async (baseUrl) => {
    const { response, payload } = await request(baseUrl, "GET", "/health");
    assert.equal(response.status, 200);
    assert.equal(payload.data.status, "ok");
  });
});

test("todo CRUD is persisted behind the API", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "POST", "/api/v1/todos", {
      text: "准备旅行",
      startAt: "2026-07-01T09:00:00+08:00",
      endAt: "2026-07-01T10:00:00+08:00"
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.payload.data.text, "准备旅行");

    const id = created.payload.data.id;
    const updated = await request(baseUrl, "PATCH", `/api/v1/todos/${id}`, {
      completed: true
    });
    assert.equal(updated.payload.data.completed, true);

    const listed = await request(
      baseUrl,
      "GET",
      "/api/v1/todos?status=completed"
    );
    assert.equal(listed.payload.data.length, 1);

    const deleted = await request(baseUrl, "DELETE", `/api/v1/todos/${id}`);
    assert.equal(deleted.response.status, 204);
  });
});

test("AI API keys are encrypted and never returned", async () => {
  await withServer(async (baseUrl, dataDir) => {
    const saved = await request(baseUrl, "PUT", "/api/v1/ai/config", {
      providerId: "openai",
      providerName: "OpenAI",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-test",
      apiKey: "secret-test-key"
    });
    assert.equal(saved.payload.data.hasApiKey, true);
    assert.equal(saved.payload.data.apiKey, undefined);

    const databaseBytes = fs.readFileSync(path.join(dataDir, "xuanai.db"));
    assert.equal(databaseBytes.includes(Buffer.from("secret-test-key")), false);
  });
});

test("profile and preferences are managed through independent APIs", async () => {
  await withServer(async (baseUrl) => {
    const profile = await request(baseUrl, "PUT", "/api/v1/profile", {
      displayName: "洛尼",
      preferredName: "洛尼",
      birthday: "11-14",
      occupation: "产品创造者",
      bio: "希望小玄能同时照顾工作和生活。",
      goals: ["保持健康", "持续创造"]
    });
    assert.equal(profile.payload.data.preferredName, "洛尼");
    assert.equal(profile.payload.data.birthday, "11-14");
    assert.deepEqual(profile.payload.data.goals, ["保持健康", "持续创造"]);

    const patched = await request(baseUrl, "PATCH", "/api/v1/profile", {
      occupation: "独立开发者"
    });
    assert.equal(patched.payload.data.occupation, "独立开发者");
    assert.equal(patched.payload.data.birthday, "11-14");

    await request(baseUrl, "PUT", "/api/v1/preferences", {
      category: "communication",
      key: "tone",
      value: "亲密、自然、俏皮",
      source: "explicit",
      confidence: 1,
      sensitivity: "normal"
    });
    const preferences = await request(
      baseUrl,
      "GET",
      "/api/v1/preferences?category=communication"
    );
    assert.equal(preferences.payload.data.length, 1);
    assert.equal(preferences.payload.data[0].source, "explicit");
  });
});

test("memory candidates can be confirmed, searched and deleted", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(baseUrl, "POST", "/api/v1/memories", {
      domain: "life",
      type: "routine",
      content: "洛尼下午喜欢喝咖啡",
      entities: ["洛尼", "咖啡"],
      source: "inferred",
      confidence: 0.65,
      importance: 0.5
    });
    assert.equal(created.payload.data.status, "candidate");
    const id = created.payload.data.id;

    const confirmed = await request(
      baseUrl,
      "POST",
      `/api/v1/memories/${id}/confirm`,
      {}
    );
    assert.equal(confirmed.payload.data.status, "active");
    assert.equal(confirmed.payload.data.source, "explicit");

    const searched = await request(
      baseUrl,
      "GET",
      `/api/v1/memories?q=${encodeURIComponent("咖啡")}`
    );
    assert.equal(searched.payload.data.length, 1);

    const deleted = await request(baseUrl, "DELETE", `/api/v1/memories/${id}`);
    assert.equal(deleted.response.status, 204);
  });
});

test("scene recall returns relevant memories with explainable reasons", async () => {
  await withServer(async (baseUrl) => {
    await request(baseUrl, "PUT", "/api/v1/profile", {
      preferredName: "洛尼",
      occupation: "产品创造者",
      goals: ["保持健康"]
    });
    await request(baseUrl, "PUT", "/api/v1/preferences", {
      category: "communication",
      key: "tone",
      value: "亲密自然",
      source: "explicit"
    });
    await request(baseUrl, "POST", "/api/v1/memories", {
      domain: "health",
      type: "routine",
      content: "洛尼希望每周运动三次",
      entities: ["洛尼", "运动"],
      source: "explicit",
      importance: 0.8
    });

    const recalled = await request(
      baseUrl,
      "POST",
      "/api/v1/memories/recall",
      { query: "帮我安排一下这周的运动计划" }
    );
    assert.equal(recalled.response.status, 200);
    assert.match(recalled.payload.data.context, /每周运动三次/);
    assert.ok(
      recalled.payload.data.items.some((item) => item.kind === "memory")
    );
    assert.ok(recalled.payload.data.items.every((item) => item.reason));
  });
});

test("automatic extraction creates deduplicated candidates only", async () => {
  const stored = [];
  const service = new MemoryIntelligenceService({
    profileService: { get: () => ({ goals: [] }) },
    preferenceService: { list: () => [] },
    memoryService: {
      list: () => stored,
      create: (_userId, candidate) => {
        const created = { id: String(stored.length + 1), ...candidate };
        stored.push(created);
        return created;
      }
    },
    memorySettingsService: { get: () => ({ autoConfirm: false }) },
    configRepository: { getCredentials: () => ({ apiKey: "test" }) },
    providerClient: {
      chat: async () => ({
        ok: true,
        data: {
          choices: [
            {
              message: {
                content: JSON.stringify([
                  {
                    domain: "life",
                    type: "routine",
                    content: "洛尼喜欢在下午喝咖啡",
                    entities: ["洛尼", "咖啡"],
                    evidence: "我一般下午会喝一杯咖啡",
                    confidence: 0.8,
                    importance: 0.5,
                    sensitivity: "normal"
                  },
                  {
                    domain: "life",
                    type: "routine",
                    content: "洛尼喜欢在下午喝咖啡。",
                    entities: ["洛尼", "咖啡"],
                    evidence: "我一般下午会喝一杯咖啡",
                    confidence: 0.8,
                    importance: 0.5,
                    sensitivity: "normal"
                  }
                ])
              }
            }
          ]
        }
      })
    }
  });

  const result = await service.extract("user", {
    userMessage: "我一般下午会喝一杯咖啡",
    assistantMessage: "知道啦"
  });
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].status, "candidate");
  assert.equal(result.candidates[0].source, "inferred");
  assert.equal(result.candidates[0].sourceExcerpt, "我一般下午会喝一杯咖啡");
});

test("memory auto-confirm setting persists and never confirms sensitive memories", async () => {
  await withServer(async (baseUrl) => {
    const defaults = await request(
      baseUrl,
      "GET",
      "/api/v1/memories/settings"
    );
    assert.equal(defaults.payload.data.autoConfirm, false);
    const saved = await request(
      baseUrl,
      "PUT",
      "/api/v1/memories/settings",
      { autoConfirm: true }
    );
    assert.equal(saved.payload.data.autoConfirm, true);
  });

  const stored = [];
  const service = new MemoryIntelligenceService({
    profileService: { get: () => ({ goals: [] }) },
    preferenceService: { list: () => [] },
    memoryService: {
      list: () => stored,
      create: (_userId, memory) => {
        const created = { id: String(stored.length + 1), ...memory };
        stored.push(created);
        return created;
      }
    },
    memorySettingsService: { get: () => ({ autoConfirm: true }) },
    configRepository: { getCredentials: () => ({ apiKey: "test" }) },
    providerClient: {
      chat: async () => ({
        ok: true,
        data: {
          choices: [{
            message: {
              content: JSON.stringify([
                {
                  domain: "life",
                  type: "routine",
                  content: "洛尼喜欢晚上散步",
                  entities: ["洛尼"],
                  evidence: "我喜欢晚上散步",
                  confidence: 0.95,
                  importance: 0.5,
                  sensitivity: "normal"
                },
                {
                  domain: "health",
                  type: "fact",
                  content: "洛尼最近需要关注一项健康问题",
                  entities: ["洛尼"],
                  evidence: "最近还有一项健康问题需要关注",
                  confidence: 0.95,
                  importance: 0.8,
                  sensitivity: "sensitive"
                }
              ])
            }
          }]
        }
      })
    }
  });

  const result = await service.extract("user", {
    userMessage: "我喜欢晚上散步，最近还有一项健康问题需要关注",
    assistantMessage: "我记下了"
  });
  assert.equal(result.autoConfirmed.length, 1);
  assert.equal(result.autoConfirmed[0].status, "active");
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].status, "candidate");
  assert.equal(result.candidates[0].sensitivity, "sensitive");
});

test("multi-turn extraction routes explicit birthday to profile and ignores product feedback", async () => {
  const profileChanges = [];
  const stored = [];
  const service = new MemoryIntelligenceService({
    profileService: {
      get: () => ({ goals: [] }),
      patch: (_userId, changes) => {
        profileChanges.push(changes);
        return changes;
      }
    },
    preferenceService: { list: () => [] },
    memoryService: {
      list: () => stored,
      create: (_userId, memory) => {
        const created = { id: String(stored.length + 1), ...memory };
        stored.push(created);
        return created;
      }
    },
    memorySettingsService: { get: () => ({ autoConfirm: true }) },
    configRepository: { getCredentials: () => ({ apiKey: "test" }) },
    providerClient: {
      chat: async () => ({
        ok: true,
        data: {
          choices: [{
            message: {
              content: JSON.stringify([
                {
                  target: "profile",
                  field: "birthday",
                  value: "11-14",
                  domain: "life",
                  type: "fact",
                  content: "洛尼的生日是11月14日",
                  entities: ["洛尼"],
                  evidence: "我的生日是11月14日",
                  confidence: 0.98,
                  importance: 0.9,
                  sensitivity: "personal"
                },
                {
                  target: "memory",
                  field: null,
                  value: "",
                  domain: "life",
                  type: "fact",
                  content: "洛尼希望系统使用记忆功能",
                  entities: ["洛尼"],
                  evidence: "为什么是待办，不应该是记忆吗",
                  confidence: 0.96,
                  importance: 0.5,
                  sensitivity: "normal"
                }
              ])
            }
          }]
        }
      })
    }
  });

  const result = await service.extract("user", {
    conversationMessages: [
      { role: "user", content: "我的生日是11月14日" },
      { role: "assistant", content: "我会记住的。" },
      { role: "user", content: "为什么是待办，不应该是记忆吗" }
    ]
  });
  assert.deepEqual(profileChanges, [{ birthday: "11-14" }]);
  assert.equal(result.profileUpdates.length, 1);
  assert.equal(result.profileUpdates[0].field, "birthday");
  assert.equal(result.candidates.length, 0);
  assert.equal(stored.length, 0);
});

test("questions cannot become profile facts even when the model proposes them", async () => {
  let patched = false;
  const service = new MemoryIntelligenceService({
    profileService: {
      get: () => ({ goals: [] }),
      patch: () => {
        patched = true;
      }
    },
    preferenceService: { list: () => [] },
    memoryService: { list: () => [], create: () => assert.fail("must not create") },
    memorySettingsService: { get: () => ({ autoConfirm: true }) },
    configRepository: { getCredentials: () => ({ apiKey: "test" }) },
    providerClient: {
      chat: async () => ({
        ok: true,
        data: {
          choices: [{
            message: {
              content: JSON.stringify([{
                target: "profile",
                field: "displayName",
                value: "洛尼",
                domain: "life",
                type: "fact",
                content: "用户名叫洛尼",
                entities: ["洛尼"],
                evidence: "你怎么知道我叫洛尼",
                confidence: 1,
                importance: 0.8,
                sensitivity: "personal"
              }])
            }
          }]
        }
      })
    }
  });

  const result = await service.extract("user", {
    userMessage: "你怎么知道我叫洛尼",
    assistantMessage: "来自当前对话。"
  });
  assert.equal(patched, false);
  assert.equal(result.profileUpdates.length, 0);
  assert.equal(result.candidates.length, 0);
});

test("complete conversations persist display and model message streams", async () => {
  await withServer(async (baseUrl) => {
    const created = await request(
      baseUrl,
      "POST",
      "/api/v1/conversations",
      { title: "完整历史测试" }
    );
    const id = created.payload.data.id;
    const saved = await request(
      baseUrl,
      "PUT",
      `/api/v1/conversations/${id}/messages`,
      {
        messages: [
          {
            id: "display-user-1",
            stream: "display",
            position: 0,
            role: "user",
            content: "第一条用户消息",
            payload: { error: false }
          },
          {
            id: "display-memory-1",
            stream: "display",
            position: 1,
            role: "memory",
            content: null,
            payload: {
              kind: "recall",
              items: [{ content: "被召回的记忆", reason: "场景相关" }]
            }
          },
          {
            id: "model-user-1",
            stream: "model",
            position: 0,
            role: "user",
            content: "第一条用户消息",
            payload: {}
          }
        ]
      }
    );
    assert.equal(saved.payload.data.saved, 3);

    await request(
      baseUrl,
      "PUT",
      `/api/v1/conversations/${id}/messages`,
      {
        messages: [
          {
            id: "display-memory-1",
            stream: "display",
            position: 1,
            role: "memory",
            content: null,
            payload: {
              kind: "recall",
              items: [{ content: "更新后的记忆", reason: "场景相关" }]
            }
          }
        ]
      }
    );

    const restored = await request(
      baseUrl,
      "GET",
      `/api/v1/conversations/${id}`
    );
    assert.equal(restored.payload.data.displayMessages.length, 2);
    assert.equal(restored.payload.data.modelMessages.length, 1);
    assert.equal(
      restored.payload.data.displayMessages[1].items[0].content,
      "更新后的记忆"
    );

    const listed = await request(
      baseUrl,
      "GET",
      "/api/v1/conversations"
    );
    assert.equal(listed.payload.data[0].title, "完整历史测试");
  });
});
