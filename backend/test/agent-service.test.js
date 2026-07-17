const assert = require("node:assert/strict");
const test = require("node:test");
const { AgentService } = require("../src/modules/agent/agent-service");

function fixture(completions, tool = { name: "todo.list", title: "查询待办", risk: "read" }) {
  const saved = [];
  const calls = [];
  const registry = {
    modelTools: () => [{ type: "function", function: { name: tool.name.replaceAll(".", "_"), parameters: {} } }],
    get: (name) => name === tool.name || name === tool.name.replaceAll(".", "_") ? tool : undefined,
    call: async (name, input) => {
      calls.push({ name, input });
      return { ok: true, content: tool.risk === "read" ? "找到 0 条待办。" : "已创建待办。", data: [] };
    },
    failure: (code, message) => ({ ok: false, content: message, error: { code } })
  };
  const services = {
    conversationService: {
      create: () => ({ id: "conversation-1", title: "测试", summary: "", createdAt: 1, updatedAt: 1 }),
      get: () => ({ conversation: { id: "conversation-1" }, displayMessages: [], modelMessages: [] }),
      saveMessages: (_userId, _id, input) => saved.push(input.messages)
    },
    memoryIntelligenceService: {
      recall: () => ({ context: "", items: [] }),
      extract: async () => ({})
    },
    promptSettingsService: { getBundle: () => ({ compiledPrompt: "自然回复" }) },
    xuanMoodService: { getHome: async () => ({}), recordEvent: async () => ({}) },
    timeAwarenessService: { getContext: () => ({ context: "权威时间" }) },
    aiConfigRepository: { getCredentials: () => ({ apiKey: "key" }) },
    providerClient: {
      chat: async () => ({ ok: true, status: 200, data: completions.shift() })
    }
  };
  const runtime = { forUser: (_userId, callback) => callback(registry) };
  return { service: new AgentService(services, runtime), saved, calls };
}

test("Agent Hub owns the complete read-tool loop and conversation persistence", async () => {
  const { service, saved, calls } = fixture([
    { choices: [{ message: { content: null, tool_calls: [{ id: "call-1", function: { name: "todo_list", arguments: "{}" } }] } }] },
    { choices: [{ message: { content: "现在没有待办，先轻松一下吧～" } }] }
  ]);
  const result = await service.chat("user-1", { content: "我有待办吗", runtime: {} });
  assert.equal(result.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(result.displayMessages.at(-1).content, "现在没有待办，先轻松一下吧～");
  assert.ok(result.displayMessages.some((message) => message.role === "tool" && message.status === "success"));
  assert.ok(saved.length >= 1);
});

test("Agent Hub pauses write tools for approval and resumes the same run", async () => {
  const { service, calls } = fixture([
    { choices: [{ message: { content: null, tool_calls: [{ id: "call-2", function: { name: "todo_create", arguments: "{}" } }] } }] },
    { choices: [{ message: { content: "已经替你记下啦～" } }] }
  ], { name: "todo.create", title: "新建待办", risk: "write" });
  const pending = await service.chat("user-1", { content: "建个待办", runtime: {} });
  assert.equal(pending.status, "approval_required");
  assert.equal(calls.length, 0);
  const completed = await service.approve("user-1", pending.runId, true);
  assert.equal(completed.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(completed.displayMessages.at(-1).content, "已经替你记下啦～");
});

test("Agent Hub prevents two devices from writing the same conversation concurrently", async () => {
  const { service } = fixture([
    { choices: [{ message: { content: null, tool_calls: [{ id: "call-lock", function: { name: "todo_create", arguments: "{}" } }] } }] },
    { choices: [{ message: { content: "这次先不创建啦。" } }] }
  ], { name: "todo.create", title: "新建待办", risk: "write" });
  const pending = await service.chat("user-1", {
    conversationId: "conversation-1",
    content: "建个待办",
    runtime: {}
  });
  await assert.rejects(
    () => service.chat("user-1", {
      conversationId: "conversation-1",
      content: "另一台设备同时发送",
      runtime: {}
    }),
    (error) => error.status === 409 && error.code === "AGENT_CONVERSATION_BUSY"
  );
  const completed = await service.approve("user-1", pending.runId, false);
  assert.equal(completed.status, "completed");
});

test("Agent Hub removes DSML and image descriptions before finalization", async () => {
  const description = "窗边微笑的自拍";
  const { service } = fixture([
    { choices: [{ message: { content: `给你看～\n<｜DSML｜tool_calls><｜DSML｜invoke name="draw_image"><｜DSML｜parameter name="prompt">${description}</｜DSML｜parameter></｜DSML｜invoke></｜DSML｜tool_calls>` } }] },
    { choices: [{ message: { content: "已经画好啦，放在上面给你看～" } }] }
  ], { name: "image.generate", title: "生成图片", risk: "write" });
  const pending = await service.chat("user-1", { content: "给我看看自拍", runtime: {} });
  const completed = await service.approve("user-1", pending.runId, true);
  assert.equal(completed.displayMessages.at(-1).content, "已经画好啦，放在上面给你看～");
  assert.equal(JSON.stringify(completed.displayMessages).includes(description), false);
});
