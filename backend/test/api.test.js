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
      occupation: "产品创造者",
      bio: "希望小玄能同时照顾工作和生活。",
      goals: ["保持健康", "持续创造"]
    });
    assert.equal(profile.payload.data.preferredName, "洛尼");
    assert.deepEqual(profile.payload.data.goals, ["保持健康", "持续创造"]);

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
                    confidence: 0.8,
                    importance: 0.5,
                    sensitivity: "normal"
                  },
                  {
                    domain: "life",
                    type: "routine",
                    content: "洛尼喜欢在下午喝咖啡。",
                    entities: ["洛尼", "咖啡"],
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
