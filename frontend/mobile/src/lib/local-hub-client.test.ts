import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalHubClient, localToolChangedGroups, sanitizeLocalModelHistory } from "./local-hub-client";

const USER = { id: "user-1", username: "luoni", displayName: "洛尼" };

describe.sequential("Android Local Hub Agent", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refreshes journals and gallery after a Local Hub journal mutation", () => {
    expect(localToolChangedGroups("journal.write")).toEqual(["journals", "gallery"]);
    expect(localToolChangedGroups("journal_write")).toEqual(["journals", "gallery"]);
    expect(localToolChangedGroups("journal.list")).toEqual(["journals", "gallery"]);
  });

  it("never truncates model history into an orphaned tool result", () => {
    const call = {
      id: "call-boundary",
      type: "function",
      function: { name: "todo_list", arguments: "{}" }
    };
    const olderPair = [
      { id: "assistant-tool", role: "assistant", content: null, tool_calls: [call], createdAt: 1 },
      { id: "tool-result", role: "tool", content: "{}", tool_call_id: call.id, createdAt: 2 }
    ];
    const ordinary = Array.from({ length: 49 }, (_, index) => ({
      id: `ordinary-${index}`,
      role: index % 2 ? "assistant" : "user",
      content: `message-${index}`,
      createdAt: index + 3
    }));

    const boundary = sanitizeLocalModelHistory([...olderPair, ...ordinary] as any, 50);
    expect(boundary.some((message) => message.role === "tool")).toBe(false);

    const recentPair = sanitizeLocalModelHistory([...ordinary, ...olderPair] as any, 50);
    const toolIndex = recentPair.findIndex((message) => message.role === "tool");
    expect(toolIndex).toBeGreaterThan(0);
    expect(recentPair[toolIndex - 1].tool_calls?.[0]?.id).toBe(recentPair[toolIndex].tool_call_id);

    const orphan = sanitizeLocalModelHistory([
      { id: "orphan", role: "tool", content: "{}", tool_call_id: "missing", createdAt: 1 },
      { id: "user", role: "user", content: "continue", createdAt: 2 }
    ] as any, 50);
    expect(orphan.map((message) => message.role)).toEqual(["user"]);
  });

  it("keeps rich journal media out of the model context", async () => {
    const hub = new FakeLocalHub();
    for (let index = 0; index < 25; index += 1) {
      hub.seed("assistant_journals", {
        id: `journal-${index}`,
        journal_type: "daily",
        title: `journal ${index}`,
        mood: "calm",
        content: `entry ${index}\n![image](data:image/png;base64,${"A".repeat(100_000)})`,
        period_key: `2026-08-${String(index + 1).padStart(2, "0")}`,
        source_from: index,
        source_to: index + 1,
        source_message_count: 1,
        created_at: index,
        updated_at: index
      });
    }
    let secondRequest = "";
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completionResponse({ toolCalls: [toolCall("journal_list", { limit: 30 })] }))
      .mockImplementationOnce(async (_url: string, init?: RequestInit) => {
        secondRequest = String(init?.body || "");
        return completionResponse({ content: "最近的日记记录已经查到了。" });
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LocalHubClient(USER, hub as never).agentChat({ content: "最近写日记了吗" });

    expect(result.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(secondRequest).not.toContain("data:image/png;base64");
    expect(secondRequest.length).toBeLessThan(200_000);
  });

  it("bounds old oversized tool history while preserving the complete call chain", () => {
    const call = toolCall("journal_list", { limit: 30 });
    const history = sanitizeLocalModelHistory([
      { id: "assistant", role: "assistant", content: null, tool_calls: [call], createdAt: 1 },
      {
        id: "tool",
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify({ data: `data:image/png;base64,${"A".repeat(2_000_000)}` }),
        createdAt: 2
      }
    ] as any, 50, 120_000);

    expect(history.map((message) => message.role)).toEqual(["assistant", "tool"]);
    expect(history[1].tool_call_id).toBe(call.id);
    expect(JSON.stringify(history)).not.toContain("data:image/png;base64");
    expect(JSON.stringify(history).length).toBeLessThan(120_000);
  });

  it("merges default modules and cascades dependent switches", async () => {
    const hub = new FakeLocalHub();
    const client = new LocalHubClient(USER, hub as never);

    const initial = await client.listModules();
    expect(initial.find((item) => item.id === "todo")?.enabled).toBe(true);
    expect(initial.find((item) => item.id === "proactive-reminders")?.enabled).toBe(true);
    expect(initial.find((item) => item.id === "ai")?.core).toBe(true);

    const updated = await client.updateModule("todo", false);
    expect(updated.find((item) => item.id === "todo")?.enabled).toBe(false);
    expect(updated.find((item) => item.id === "proactive-reminders")?.enabled).toBe(false);
    expect(hub.lastBatchTypes()).toEqual(["module_settings", "module_settings"]);
    await expect(client.updateModule("ai", false)).rejects.toMatchObject({ code: "CORE_MODULE_REQUIRED" });
  });

  it("exposes complete replicated records to desktop clients", async () => {
    const hub = new FakeLocalHub({ imageEnabled: true });
    hub.seed("ai_configs", {
      provider_id: "openai",
      provider_name: "OpenAI",
      base_url: "https://provider.example/v1",
      model: "chat-model",
      updated_at: 10
    });
    hub.seed("ai_image_configs", {
      provider_id: "volcengine",
      provider_name: "Image Provider",
      base_url: "https://images.example/v1",
      model: "image-model",
      updated_at: 11
    });
    hub.seed("user_preferences", {
      id: "preference-1",
      category: "food",
      preference_key: "drink",
      value_json: JSON.stringify("tea"),
      source: "explicit",
      confidence: 1,
      sensitivity: "normal",
      created_at: 12,
      updated_at: 13
    });
    hub.seed("memory_settings", { auto_confirm: 1, auto_confirm_all: 0, updated_at: 14 });
    hub.seed("prompt_settings", {
      version: 3,
      settings_json: JSON.stringify({ tone: "自然", behaviorRules: ["先理解再行动"] }),
      updated_at: 15
    });
    hub.seed("prompt_setting_versions", { id: "prompt-v3", version: 3, created_at: 15 });
    hub.seed("xuan_mood_state", {
      state_json: JSON.stringify({ currentMood: "专注", physiology: { heartRateBpm: 72 } }),
      updated_at: 16
    });
    hub.seed("xuan_mood_displays", {
      id: "display-1", title: "专注", line: "正在认真处理同步", detail: "",
      focus: "双 Hub", tone: "focused", based_on_event_ids_json: "[]",
      expires_at: 1000, created_at: 17
    });
    const client = new LocalHubClient(USER, hub as never);

    await expect(client.aiConfig()).resolves.toMatchObject({ model: "chat-model", hasApiKey: true });
    await expect(client.aiImageConfig()).resolves.toMatchObject({ model: "image-model", hasApiKey: true });
    await expect(client.listPreferences()).resolves.toMatchObject([{ key: "drink", value: "tea" }]);
    await expect(client.memorySettings()).resolves.toMatchObject({ autoConfirm: true, autoConfirmAll: false });
    await expect(client.promptSettings()).resolves.toMatchObject({ version: 3, settings: { tone: "自然" } });
    await expect(client.promptVersions()).resolves.toEqual([{ version: 3, createdAt: 15 }]);
    await expect(client.xuanMoodHome()).resolves.toMatchObject({
      state: { state: { currentMood: "专注", physiology: { heartRateBpm: 72 } } },
      display: { id: "display-1", tone: "focused" }
    });
  });

  it("merges legacy conversations into the replicated primary conversation", async () => {
    const hub = new FakeLocalHub();
    hub.seed("conversations", { id: "conversation-a", title: "A", summary: "", created_at: 1, updated_at: 2 });
    hub.seed("conversations", { id: "conversation-b", title: "B", summary: "", created_at: 1, updated_at: 3 });
    hub.seed("messages", {
      id: "message-a",
      conversation_id: "conversation-a",
      stream_type: "display",
      position: 4,
      role: "user",
      content: "A message",
      payload_json: "{}",
      created_at: 1
    });
    hub.seed("messages", {
      id: "message-b",
      conversation_id: "conversation-b",
      stream_type: "display",
      position: 8,
      role: "user",
      content: "B message",
      payload_json: "{}",
      created_at: 2
    });
    hub.seed("messages", {
      id: "message-model",
      conversation_id: "conversation-a",
      stream_type: "model",
      position: 7,
      role: "assistant",
      content: "model context",
      payload_json: "{}",
      created_at: 3
    });
    hub.seed("memory_evidence", {
      id: "evidence-a",
      user_id: "__CURRENT_USER__",
      memory_id: "memory-a",
      conversation_id: "conversation-a",
      evidence: "legacy evidence",
      evidence_hash: "a".repeat(64),
      confidence: 0.9,
      created_at: 4
    });

    const client = new LocalHubClient(USER, hub as never);
    await expect(client.listConversations()).resolves.toMatchObject([{ id: "conversation-b" }]);
    const result = await client.conversation("conversation-b");

    expect(result.displayMessages.map((message) => message.id)).toEqual(["message-a", "message-b"]);
    expect(result.modelMessages.map((message) => message.id)).toEqual(["message-model"]);
    expect(hub.rows("conversations").map((row) => row.id)).toEqual(["conversation-b"]);
    expect(hub.rows("messages").map((row) => [row.id, row.conversation_id, row.position])).toEqual([
      ["message-a", "conversation-b", 0],
      ["message-b", "conversation-b", 1],
      ["message-model", "conversation-b", 0]
    ]);
    expect(hub.rows("memory_evidence")[0].conversation_id).toBe("conversation-b");
    expect(hub.batches.flat().map((mutation) => `${mutation.entityType}:${mutation.operation || "upsert"}`)).toEqual([
      "conversations:upsert",
      "messages:upsert",
      "messages:upsert",
      "messages:upsert",
      "memory_evidence:upsert",
      "conversations:delete"
    ]);
    await expect(client.createConversation("不应新建")).resolves.toMatchObject({ id: "conversation-b" });
  });

  it("chunks large legacy conversation migrations before deleting old conversations", async () => {
    const hub = new FakeLocalHub();
    hub.seed("conversations", { id: "conversation-old", title: "Old", summary: "", created_at: 1, updated_at: 1 });
    hub.seed("conversations", { id: "conversation-primary", title: "Primary", summary: "", created_at: 2, updated_at: 2 });
    for (let index = 0; index < 205; index += 1) {
      hub.seed("messages", {
        id: `message-${String(index).padStart(3, "0")}`,
        conversation_id: "conversation-old",
        stream_type: "display",
        position: 205 - index,
        role: "user",
        content: `message ${index}`,
        payload_json: "{}",
        created_at: index
      });
    }

    await new LocalHubClient(USER, hub as never).listConversations();

    expect(hub.batches.map((batch) => batch.length)).toEqual([100, 100, 7]);
    expect(hub.batches.flat().at(-1)).toMatchObject({
      entityType: "conversations",
      entityId: "conversation-old",
      operation: "delete"
    });
    expect(hub.rows("conversations").map((row) => row.id)).toEqual(["conversation-primary"]);
    expect(hub.rows("messages")).toHaveLength(205);
    expect(hub.rows("messages").every((row) => row.conversation_id === "conversation-primary")).toBe(true);
  });

  it("keeps core profile tools while excluding disabled extension tools", async () => {
    const hub = new FakeLocalHub();
    hub.seed("module_settings", {
      module_id: "memory",
      enabled: 0,
      updated_at: 10
    });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const names = body.tools.map((tool: any) => tool.function.name);
      expect(names).toContain("profile_get");
      expect(names).toContain("assistant_profile_get");
      expect(names).not.toContain("memory_list");
      return completionResponse({ content: "工具边界已经按模块开关生效。" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LocalHubClient(USER, hub as never).agentChat({ content: "检查模块" });
    expect(result.status).toBe("completed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("runs read tools without approval and understands DSML calls", async () => {
    const hub = new FakeLocalHub();
    hub.seed("todos", {
      id: "todo-1",
      user_id: "__CURRENT_USER__",
      text: "整理双 Hub 测试",
      start_at: 100,
      end_at: 200,
      completed: 0,
      created_at: 50,
      updated_at: 50
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completionResponse({
        content: `<|DSML|tool_calls><|DSML|invoke name="todo.list"><|DSML|parameter name="status">all</|DSML|parameter></|DSML|invoke></|DSML|tool_calls>`
      }))
      .mockResolvedValueOnce(completionResponse({ content: "找到那条双 Hub 待办了。" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LocalHubClient(USER, hub as never).agentChat({ content: "看看待办" });
    expect(result.status).toBe("completed");
    expect(result.displayMessages.some((item: any) => item.role === "tool" && item.status === "success")).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("pauses ordinary writes, resumes the same run, and always confirms destructive tools", async () => {
    const hub = new FakeLocalHub();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completionResponse({
        toolCalls: [toolCall("todo_create", {
          title: "离线创建待办",
          startAt: "2026-08-01T01:00:00.000Z",
          endAt: "2026-08-01T02:00:00.000Z"
        })]
      }))
      .mockResolvedValueOnce(completionResponse({ content: "待办已经在手机 Hub 里记下了。" }))
      .mockResolvedValueOnce(completionResponse({
        toolCalls: [toolCall("todo_delete", { id: "todo-delete" })]
      }));
    vi.stubGlobal("fetch", fetchMock);
    const client = new LocalHubClient(USER, hub as never);

    const waiting = await client.agentChat({ content: "帮我建个待办" });
    expect(waiting.status).toBe("approval_required");
    expect(hub.rows("todos")).toHaveLength(0);
    const completed = await client.approveAgentRun(waiting.runId!, true);
    expect(completed.status).toBe("completed");
    expect(completed.toolMutated).toBe(true);
    expect(hub.rows("todos")).toHaveLength(1);

    hub.seed("module_settings", {
      module_id: "__agent_auto_approve_writes__",
      enabled: 1,
      updated_at: 20
    });
    hub.seed("todos", {
      id: "todo-delete",
      text: "仍需确认删除",
      start_at: 100,
      end_at: 200,
      completed: 0,
      created_at: 50,
      updated_at: 50
    });
    const destructive = await client.agentChat({ content: "删除那条待办" });
    expect(destructive.status).toBe("approval_required");
    expect(hub.rows("todos").some((item) => item.id === "todo-delete")).toBe(true);
  });

  it("commits wallet accounts and opening transactions in one local transaction", async () => {
    const hub = new FakeLocalHub();
    hub.seed("module_settings", {
      module_id: "__agent_auto_approve_writes__",
      enabled: 1,
      updated_at: 20
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(completionResponse({
        toolCalls: [toolCall("wallet_create", {
          name: "旅行基金",
          amount: 1234.56,
          currency: "CNY",
          detail: "手机 Hub 离线录入"
        })]
      }))
      .mockResolvedValueOnce(completionResponse({ content: "旅行基金已经完整记好了。" }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LocalHubClient(USER, hub as never).agentChat({ content: "记录旅行基金" });
    expect(result.status).toBe("completed");
    expect(hub.lastBatchTypes()).toEqual(["wallet_accounts", "wallet_transactions"]);
    expect(hub.rows("wallet_accounts")[0].balance_minor).toBe(123456);
    expect(hub.rows("wallet_transactions")[0].balance_after_minor).toBe(123456);
  });

  it("stores generated originals as media assets for later reverse replication", async () => {
    const hub = new FakeLocalHub({ imageEnabled: true });
    hub.seed("module_settings", {
      module_id: "__agent_auto_approve_writes__",
      enabled: 1,
      updated_at: 20
    });
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).includes("/images/generations")) {
        return jsonResponse({ data: [{ b64_json: "aGVsbG8=" }] });
      }
      if (fetchMock.mock.calls.filter(([calledUrl]) => !String(calledUrl).includes("/images/generations")).length === 1) {
        return completionResponse({
          toolCalls: [toolCall("image_generate", { description: "窗边的清晨", selfie: false })]
        });
      }
      return completionResponse({ content: "这张清晨画面已经保存进相册。" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await new LocalHubClient(USER, hub as never).agentChat({ content: "画一张清晨" });
    expect(result.status).toBe("completed");
    expect(hub.storeMediaCalls).toBe(1);
    expect(hub.rows("media_assets")).toHaveLength(1);
    expect(result.displayMessages.some((item: any) => item.role === "tool" && item.image?.mediaId)).toBe(true);
  });

  it("derives memory evidence and continuous mood state only when those modules are enabled", async () => {
    const hub = new FakeLocalHub();
    hub.seed("module_settings", { module_id: "memory", enabled: 1, updated_at: 2 });
    hub.seed("module_settings", { module_id: "xuan-mood", enabled: 1, updated_at: 2 });
    hub.seed("memory_settings", { auto_confirm: 1, auto_confirm_all: 0, updated_at: 2 });
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body || "{}"));
      const system = String(body.messages?.[0]?.content || "");
      if (system.includes("长期记忆筛选器")) {
        return completionResponse({
          content: JSON.stringify([{
            target: "memory",
            domain: "work",
            type: "decision",
            content: "洛尼决定把 Android Local Hub 完整迁入手机端",
            memoryKey: "project.android_local_hub",
            entities: ["Android Local Hub"],
            evidence: "我要把 Android Local Hub 完整迁进去",
            confidence: 0.98,
            importance: 0.9,
            sensitivity: "normal"
          }])
        });
      }
      if (system.includes("心情模块")) {
        return completionResponse({
          content: JSON.stringify({
            event: { summary: "一起完成迁移", emotionalTone: "专注又开心", effectOnXuan: "更有成就感", intensity: "high" },
            state: { currentMood: "专注而开心", energy: "充沛", attention: "Android Local Hub" },
            display: { title: "一起收尾", line: "迁移终于完整落进手机里了", detail: "我还在认真盯着完整性。", focus: "双 Hub", tone: "happy", expiresInMinutes: 20 }
          })
        });
      }
      return completionResponse({ content: "好，我会把这次迁移完整收好。" });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new LocalHubClient(USER, hub as never);
    await client.agentChat({ content: "我要把 Android Local Hub 完整迁进去" });
    await waitFor(() => hub.rows("memories").length === 1 && hub.rows("xuan_mood_state").length === 1);

    expect(hub.rows("memory_evidence")).toHaveLength(1);
    expect(hub.rows("memories")[0].status).toBe("active");
    expect(hub.rows("xuan_mood_events")).toHaveLength(1);
    expect(JSON.parse(hub.rows("xuan_mood_state")[0].state_json).physiology.heartRateBpm).toBeGreaterThan(60);
    expect(hub.rows("xuan_mood_displays")).toHaveLength(1);
  });
});

class FakeLocalHub {
  private readonly documents = new Map<string, Map<string, Record<string, any>>>();
  readonly batches: Array<Array<Record<string, any>>> = [];
  readonly listDocumentInputs: Array<Record<string, any>> = [];
  storeMediaCalls = 0;
  private readonly imageEnabled: boolean;

  constructor(options: { imageEnabled?: boolean } = {}) {
    this.imageEnabled = options.imageEnabled === true;
    this.seed("module_settings", { module_id: "memory", enabled: 0, updated_at: 1 });
    this.seed("module_settings", { module_id: "xuan-mood", enabled: 0, updated_at: 1 });
    this.seed("user_profiles", { user_id: "__CURRENT_USER__", display_name: "洛尼", preferred_name: "洛尼" });
    this.seed("assistant_profiles", {
      user_id: "__CURRENT_USER__",
      name: "小玄",
      self_definition: "会持续成长的伙伴",
      relationship_summary: "洛尼的搭子",
      traits_json: "[]",
      values_json: "[]"
    });
  }

  seed(type: string, payload: Record<string, any>) {
    const id = String(payload.id || payload.module_id || (type.endsWith("profiles") ? "profile" : crypto.randomUUID()));
    if (!this.documents.has(type)) this.documents.set(type, new Map());
    this.documents.get(type)!.set(id, structuredClone(payload));
  }

  rows(type: string) {
    return [...(this.documents.get(type)?.values() || [])].map((item) => structuredClone(item));
  }

  lastBatchTypes() {
    return (this.batches.at(-1) || []).map((item) => String(item.entityType));
  }

  async refresh() {
    return {
      running: true,
      configured: true,
      port: 0,
      serverUrl: "capacitor://local-hub",
      nodeId: "mobile-node",
      localNodeId: "mobile-node",
      activeNodeId: "mobile-node",
      spaceId: "space-1",
      epoch: 2,
      state: "stable",
      role: "active",
      transitionId: "",
      transitionTargetNodeId: "",
      transitionStartedAt: null,
      protocolVersion: 1,
      schemaVersion: 3,
      documentCount: 0,
      operationCount: 0,
      mediaCount: 0,
      pendingMediaCount: 0,
      mediaBytes: 0,
      mediaTotalBytes: 0,
      bootstrap: null,
      integrity: null
    };
  }

  async listDocuments(input: { entityType: string; payloadField?: string; payloadValue?: string }) {
    this.listDocumentInputs.push(structuredClone(input));
    const rows = this.rows(input.entityType).filter((payload) => (
      !input.payloadField || String(payload[input.payloadField] || "") === String(input.payloadValue || "")
    ));
    return {
      documents: rows.map((payload) => ({
        entityId: String(payload.id || payload.module_id || "profile"),
        version: 1,
        payload,
        deleted: false,
        updatedAt: Number(payload.updated_at || 0)
      }))
    };
  }

  async mutateDocument(input: Record<string, any>) {
    this.applyMutation(input);
    return {};
  }

  async mutateDocuments(input: { mutations: Array<Record<string, any>> }) {
    this.batches.push(structuredClone(input.mutations));
    input.mutations.forEach((mutation) => this.applyMutation(mutation));
    return { operations: [] };
  }

  private applyMutation(input: Record<string, any>) {
    const type = String(input.entityType);
    const id = String(input.entityId);
    if (!this.documents.has(type)) this.documents.set(type, new Map());
    if (input.operation === "delete") this.documents.get(type)!.delete(id);
    else this.documents.get(type)!.set(id, structuredClone(input.documentPayload || input.payload || {}));
  }

  async providerCredentials() {
    return { baseUrl: "https://provider.example/v1", model: "test-model", apiKey: "test-key" };
  }

  async imageProviderCredentials() {
    if (!this.imageEnabled) throw new Error("IMAGE_DISABLED");
    return { baseUrl: "https://provider.example/v1", model: "test-image", apiKey: "image-key" };
  }

  async storeMedia() {
    this.storeMediaCalls += 1;
    return {
      mediaId: "generated-media-1",
      mimeType: "image/png",
      fileName: "generated-media-1.png",
      byteSize: 5,
      contentHash: "a".repeat(64),
      localPath: "C:/media/generated-media-1.png"
    };
  }
}

function toolCall(name: string, input: Record<string, unknown>) {
  return {
    id: `call-${name}`,
    type: "function",
    function: { name, arguments: JSON.stringify(input) }
  };
}

function completionResponse(input: { content?: string; toolCalls?: Array<Record<string, unknown>> }) {
  return jsonResponse({
    choices: [{
      message: {
        content: input.content ?? null,
        ...(input.toolCalls ? { tool_calls: input.toolCalls } : {})
      }
    }]
  });
}

function jsonResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function waitFor(condition: () => boolean, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("等待本地派生任务超时");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
