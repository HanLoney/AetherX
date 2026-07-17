const { randomUUID } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");

const MAX_TOOL_ROUNDS = 6;
const RUN_TTL_MS = 10 * 60_000;
const TOOL_PRIVACY_PROMPT =
  "工具参数、图片生成描述和内部提示词只用于执行，不得在最终回复中复述、改写或概括。" +
  "图片已经通过工具卡片展示时，只需用符合当前人格的简短自然语言回应已经画好。";

class AgentService {
  constructor(services, toolRuntime) {
    this.services = services;
    this.toolRuntime = toolRuntime;
    this.runs = new Map();
    this.activeConversations = new Map();
  }

  async chat(userId, input = {}) {
    this.pruneRuns();
    const content = String(input.content || "").trim().slice(0, 30_000);
    if (!content) {
      throw new HttpError(400, "AGENT_MESSAGE_REQUIRED", "消息不能为空。");
    }
    const loaded = input.conversationId
      ? this.services.conversationService.get(userId, String(input.conversationId))
      : {
          conversation: this.services.conversationService.create(userId, {
            title: content.slice(0, 60)
          }),
          displayMessages: [],
          modelMessages: []
        };
    const conversationKey = `${userId}:${loaded.conversation.id}`;
    if (this.activeConversations.has(conversationKey)) {
      throw new HttpError(
        409,
        "AGENT_CONVERSATION_BUSY",
        "这段对话还有一条消息正在处理，请稍后再发送。"
      );
    }
    const lockId = randomUUID();
    this.activeConversations.set(conversationKey, lockId);
    try {
      const userMessage = message("user", content);
      const recalled = this.services.memoryIntelligenceService.recall(userId, {
        query: content
      });
      const prompt =
        this.services.promptSettingsService.getBundle(userId).compiledPrompt || "";
      const moodContext = await this.moodContext(userId);
      const timeContext = this.services.timeAwarenessService.getContext(userId, {
        timeZone: input.runtime?.timeZone,
        locale: input.runtime?.locale,
        currentUserMessage: content
      }).context;
      const system = [
        timeContext,
        prompt,
        moodContext,
        recalled.context,
        TOOL_PRIVACY_PROMPT
      ]
        .filter(Boolean)
        .join("\n\n");
      const displayMessages = [
        ...sanitizeStoredHistory(loaded.displayMessages, true),
        userMessage
      ];
      if (recalled.items?.length) {
        displayMessages.push({
          id: randomUUID(),
          role: "memory",
          content: "",
          kind: "recall",
          items: recalled.items,
          createdAt: Date.now()
        });
      }
      const run = {
        id: randomUUID(),
        userId,
        conversation: loaded.conversation,
        userContent: content,
        system,
        runtime: input.runtime || {},
        displayMessages,
        modelMessages: [
          ...sanitizeStoredHistory(loaded.modelMessages, false),
          { ...userMessage, id: randomUUID() }
        ],
        seenCalls: new Map(),
        lastSignature: "",
        summaries: [],
        round: 0,
        currentCalls: [],
        callIndex: 0,
        roundModelStart: 0,
        recoveredProtocol: false,
        roundResults: [],
        pending: null,
        toolMutated: false,
        conversationKey,
        updatedAt: Date.now()
      };
      const result = await this.toolRuntime.forUser(userId, async (registry) => {
        run.registry = registry;
        return this.advance(run);
      });
      if (result.status === "approval_required") {
        this.activeConversations.set(conversationKey, run.id);
      } else {
        this.releaseConversation(conversationKey, lockId);
      }
      return result;
    } catch (error) {
      this.releaseConversation(conversationKey, lockId);
      throw error;
    }
  }

  async approve(userId, runId, approved) {
    this.pruneRuns();
    const run = this.runs.get(String(runId));
    if (!run || run.userId !== userId || !run.pending) {
      throw new HttpError(404, "AGENT_RUN_NOT_FOUND", "这次工具申请已经失效，请重新发送消息。");
    }
    this.runs.delete(run.id);
    try {
      const result = await this.toolRuntime.forUser(userId, async (registry) => {
        run.registry = registry;
        const { call, tool, activity } = run.pending;
        run.pending = null;
        const result = approved
          ? await this.executeTool(run, tool, call, activity)
          : this.denyTool(activity);
        this.finishCall(run, call, tool, result);
        run.callIndex += 1;
        return this.advance(run);
      });
      if (result.status !== "approval_required") {
        this.releaseConversation(run.conversationKey, run.id);
      }
      return result;
    } catch (error) {
      this.releaseConversation(run.conversationKey, run.id);
      throw error;
    }
  }

  async advance(run) {
    while (run.round < MAX_TOOL_ROUNDS) {
      while (run.callIndex < run.currentCalls.length) {
        const call = run.currentCalls[run.callIndex];
        const tool = run.registry.get(call.name);
        const activity = createToolActivity(tool, call);
        run.displayMessages.push(activity);
        const signature = callSignature(call);
        const shouldReuse = run.seenCalls.has(signature) &&
          (tool?.risk !== "read" || run.lastSignature === signature);
        if (shouldReuse) {
          const previous = run.seenCalls.get(signature);
          const result = {
            ...previous,
            content: `检测到重复调用，未再次执行。${previous.content}`,
            repeated: true
          };
          finishActivity(activity, result, "skipped", "已跳过重复调用");
          this.finishCall(run, call, tool, result, true);
          run.callIndex += 1;
          continue;
        }
        if (!tool) {
          const result = run.registry.failure("TOOL_NOT_FOUND", `未注册工具：${call.name}`);
          finishActivity(activity, result, "error", "工具不可用");
          this.finishCall(run, call, tool, result);
          run.callIndex += 1;
          continue;
        }
        if (tool.risk !== "read") {
          activity.status = "waiting";
          activity.statusText = "等待你的允许";
          activity.expanded = true;
          run.pending = { call, tool, activity };
          run.updatedAt = Date.now();
          this.runs.set(run.id, run);
          return this.respond(run, "approval_required");
        }
        const result = await this.executeTool(run, tool, call, activity);
        this.finishCall(run, call, tool, result);
        run.callIndex += 1;
      }

      if (run.currentCalls.length) {
        if (run.recoveredProtocol) {
          const content = await this.finalizeRecovered(run);
          run.modelMessages.splice(run.roundModelStart);
          this.completeWith(run, content);
          return this.finish(run);
        }
        run.currentCalls = [];
        run.callIndex = 0;
        run.roundResults = [];
      }

      run.roundModelStart = run.modelMessages.length;
      const completion = await this.complete(run, run.registry.modelTools());
      const calls = completion.toolCalls.map(normalizeAgentCall);
      run.modelMessages.push({
        id: randomUUID(),
        role: "assistant",
        content: completion.content || null,
        ...(calls.length ? {
          tool_calls: calls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.rawArguments }
          }))
        } : {}),
        createdAt: Date.now()
      });
      if (!calls.length) {
        this.completeWith(run, completion.content, false);
        return this.finish(run);
      }
      run.currentCalls = calls;
      run.callIndex = 0;
      run.roundResults = [];
      run.recoveredProtocol = calls.some((call) => call.protocol === "dsml");
      run.round += 1;
    }
    const content = await this.finalize(run, `已达到 ${MAX_TOOL_ROUNDS} 轮安全上限`);
    this.completeWith(run, content);
    return this.finish(run);
  }

  async executeTool(run, tool, call, activity) {
    activity.status = "running";
    activity.statusText = tool.risk === "read" ? "读取中" : "已允许 · 执行中";
    const result = await run.registry.call(call.name, call.rawArguments);
    finishActivity(
      activity,
      result,
      result.ok ? "success" : "error",
      result.ok ? "执行成功" : "执行失败"
    );
    decorateActivity(activity, tool.name, result);
    if (result.ok && tool.risk !== "read") run.toolMutated = true;
    return result;
  }

  denyTool(activity) {
    const result = { ok: false, content: "用户拒绝执行此操作。", error: { code: "USER_DENIED" } };
    finishActivity(activity, result, "denied", "已拒绝");
    return result;
  }

  finishCall(run, call, tool, result, reused = false) {
    const signature = callSignature(call);
    if (!reused) run.seenCalls.set(signature, result);
    run.lastSignature = signature;
    run.summaries.push(result.content);
    run.roundResults.push(result);
    run.modelMessages.push({
      id: randomUUID(),
      role: "tool",
      tool_call_id: call.id,
      content: JSON.stringify(modelSafeToolResult(result)),
      createdAt: Date.now()
    });
  }

  async complete(run, tools) {
    const config = this.services.aiConfigRepository.getCredentials(run.userId);
    const result = await this.services.providerClient.chat(config, {
      messages: [
        { role: "system", content: run.system },
        ...run.modelMessages.slice(-50).map(toModelMessage)
      ],
      tools
    });
    return extractCompletion(result);
  }

  async finalizeRecovered(run) {
    const cleanHistory = run.modelMessages.slice(0, run.roundModelStart);
    try {
      const config = this.services.aiConfigRepository.getCredentials(run.userId);
      const result = await this.services.providerClient.chat(config, {
        messages: [
          {
            role: "system",
            content:
              `${run.system}\n\n刚才模型把工具调用误写成了文本协议，客户端已经完成执行。` +
              "请根据下面经过脱敏的真实执行结果自然收尾，不要再调用工具，不要复述工具参数、图片描述或内部提示词。"
          },
          ...cleanHistory
            .filter((item) => ["user", "assistant"].includes(item.role) && !item.tool_calls?.length)
            .slice(-30)
            .map(toModelMessage),
          {
            role: "system",
            content: `已完成的工具结果：${JSON.stringify(run.roundResults.map(modelSafeToolResult))}`
          }
        ],
        tools: []
      });
      const completion = extractCompletion(result);
      if (completion.content && !completion.toolCalls.length) return completion.content;
    } catch {
      // Use verified local tool results when the provider rejects repaired history.
    }
    return safeToolFallback(run.roundResults);
  }

  async finalize(run, reason) {
    try {
      const config = this.services.aiConfigRepository.getCredentials(run.userId);
      const result = await this.services.providerClient.chat(config, {
        messages: [
          {
            role: "system",
            content:
              `${run.system}\n\n工具阶段已经结束，原因：${reason}。` +
              "请严格根据已有工具结果直接回答，不要再请求工具，也不要复述工具参数或图片描述。"
          },
          ...run.modelMessages.slice(-50).map(toModelMessage)
        ],
        tools: []
      });
      const completion = extractCompletion(result);
      if (completion.content) return completion.content;
    } catch {
      // Fall through to verified results.
    }
    return safeToolFallback(run.roundResults.length ? run.roundResults : [
      { ok: true, content: run.summaries.at(-1) || "工具已经执行结束。" }
    ]);
  }

  completeWith(run, content, appendModel = true) {
    const assistant = message("assistant", content);
    run.displayMessages.push(assistant);
    if (appendModel) run.modelMessages.push({ ...assistant, id: randomUUID() });
    run.finalContent = content;
  }

  async finish(run) {
    this.runs.delete(run.id);
    this.afterCompletion(run);
    return this.respond(run, "completed");
  }

  persist(run) {
    const records = [
      ...run.displayMessages
        .map((item, index) => historyRecord(item, "display", index))
        .slice(-100),
      ...run.modelMessages
        .map((item, index) => historyRecord(item, "model", index))
        .slice(-100)
    ];
    this.services.conversationService.saveMessages(
      run.userId,
      run.conversation.id,
      { messages: records }
    );
    run.conversation = this.services.conversationService.get(
      run.userId,
      run.conversation.id
    ).conversation;
  }

  afterCompletion(run) {
    const conversationMessages = run.modelMessages
      .filter((item) => ["user", "assistant"].includes(item.role) && typeof item.content === "string")
      .slice(-12)
      .map(({ role, content }) => ({ role, content }));
    void this.services.memoryIntelligenceService.extract(run.userId, {
      userMessage: run.userContent,
      assistantMessage: run.finalContent,
      conversationId: run.conversation.id,
      conversationMessages
    }).catch(() => undefined);
    void this.services.xuanMoodService.recordEvent(run.userId, {
      sourceType: "chat",
      sourceId: run.conversation.id,
      userMessage: run.userContent,
      assistantMessage: run.finalContent,
      conversationMessages
    }).catch(() => undefined);
  }

  respond(run, status) {
    this.persist(run);
    return {
      status,
      runId: status === "approval_required" ? run.id : null,
      conversation: run.conversation,
      displayMessages: run.displayMessages,
      toolMutated: run.toolMutated,
      pendingApproval: status === "approval_required"
        ? { activityId: run.pending.activity.id }
        : null
    };
  }

  async moodContext(userId) {
    try {
      const snapshot = await this.services.xuanMoodService.getHome(userId);
      const state = snapshot?.state?.state || snapshot?.state || {};
      const display = snapshot?.display || {};
      const lines = [
        "[当前心情状态]",
        state.currentMood && `心情：${state.currentMood}`,
        state.energy && `精力：${state.energy}`,
        state.attention && `关注点：${state.attention}`,
        display.detail && `近况：${display.detail}`
      ].filter(Boolean);
      return lines.length > 1 ? lines.join("\n") : "";
    } catch {
      return "";
    }
  }

  pruneRuns() {
    const expiredBefore = Date.now() - RUN_TTL_MS;
    for (const [id, run] of this.runs) {
      if (run.updatedAt < expiredBefore) {
        this.runs.delete(id);
        this.releaseConversation(run.conversationKey, id);
      }
    }
  }

  releaseConversation(key, owner) {
    if (this.activeConversations.get(key) === owner) {
      this.activeConversations.delete(key);
    }
  }
}

function extractCompletion(result) {
  if (!result?.ok) {
    const message = result?.data?.error?.message || result?.data?.message || "AI 服务请求失败。";
    throw new HttpError(result?.status || 502, "AI_UPSTREAM_ERROR", message);
  }
  const choice = result.data?.choices?.[0] || {};
  const messageValue = choice.message || choice.delta || {};
  const text = extractText(result.data);
  const parsed = parseDsml(text);
  const native = normalizeNativeCalls(messageValue.tool_calls || messageValue.function_call);
  const toolCalls = dedupeCalls([...native, ...parsed.calls]);
  if (!parsed.content && !toolCalls.length) {
    throw new HttpError(502, "AI_EMPTY_COMPLETION", "模型没有返回可读内容或工具调用。");
  }
  return { content: parsed.content, toolCalls };
}

function extractText(data) {
  const choice = data?.choices?.[0] || {};
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? data?.output_text;
  if (typeof content === "string") return sanitize(content);
  if (Array.isArray(content)) {
    return sanitize(content.map((part) => typeof part === "string"
      ? part
      : part?.text?.value || part?.text || part?.content || "").join(""));
  }
  if (content && typeof content === "object") {
    return sanitize(String(content.text?.value || content.text || content.value || ""));
  }
  return "";
}

function sanitize(value) {
  return String(value || "").replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think\s*>/gi, "").trim();
}

function normalizeNativeCalls(value) {
  const calls = Array.isArray(value) ? value : value?.name ? [{ function: value }] : [];
  return calls.flatMap((call, index) => {
    const name = String(call?.function?.name || "").trim();
    if (!name) return [];
    let parameters = {};
    try {
      const raw = typeof call.function.arguments === "string"
        ? JSON.parse(call.function.arguments || "{}")
        : call.function.arguments;
      parameters = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    } catch {
      parameters = {};
    }
    return [{
      id: String(call.id || `agent-tool-${Date.now()}-${index}`),
      protocol: "native",
      name,
      arguments: parameters
    }];
  });
}

function parseDsml(source) {
  const original = String(source || "");
  if (!/DSML/i.test(original)) return { content: original.trim(), calls: [] };
  const calls = [];
  const toolBlock = /<[|｜]+DSML[|｜]+tool_calls\s*>([\s\S]*?)<\/[|｜]+DSML[|｜]+tool_calls\s*>/gi;
  const invokeBlock = /<[|｜]+DSML[|｜]+invoke\b([^>]*)>([\s\S]*?)<\/[|｜]+DSML[|｜]+invoke\s*>/gi;
  const parameterBlock = /<[|｜]+DSML[|｜]+parameter\b([^>]*)>([\s\S]*?)<\/[|｜]+DSML[|｜]+parameter\s*>/gi;
  const content = original.replace(toolBlock, (_block, body) => {
    for (const match of body.matchAll(invokeBlock)) {
      const name = attribute(match[1], "name");
      if (!name) continue;
      const parameters = {};
      for (const parameter of match[2].matchAll(parameterBlock)) {
        const key = attribute(parameter[1], "name");
        if (key) parameters[key] = String(parameter[2] || "").trim();
      }
      calls.push({ protocol: "dsml", name, arguments: parameters });
    }
    return "";
  }).trim();
  return { content, calls };
}

function sanitizeStoredHistory(messages, displayStream) {
  return (Array.isArray(messages) ? messages : []).flatMap((item) => {
    if (item?.role !== "assistant" || typeof item.content !== "string") {
      return [item];
    }
    const parsed = parseDsml(item.content);
    if (!parsed.calls.length) return [item];
    if (!parsed.content && !displayStream) return [];
    return [{
      ...item,
      content: parsed.content || "这条历史回复曾包含未执行的工具请求。"
    }];
  });
}

function attribute(source, name) {
  const match = String(source || "").match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return String(match?.[2] || "").trim();
}

function dedupeCalls(calls) {
  const seen = new Set();
  return calls.filter((call) => {
    const signature = `${call.name}:${JSON.stringify(call.arguments)}`;
    if (seen.has(signature)) return false;
    seen.add(signature);
    return true;
  });
}

function normalizeAgentCall(call, index) {
  let name = call.name;
  let parameters = { ...call.arguments };
  if (["draw_image", "generate_image"].includes(name)) {
    name = "image_generate";
    parameters = {
      description: String(parameters.prompt || parameters.description || "").trim(),
      selfie: parameters.selfie === undefined ? true : parameters.selfie
    };
  }
  return {
    id: call.id || `agent-tool-${Date.now()}-${index}-${randomUUID()}`,
    protocol: call.protocol,
    name,
    rawArguments: JSON.stringify(parameters)
  };
}

function createToolActivity(tool, call) {
  const imageTool = ["image_generate", "image.generate"].includes(call.name);
  return {
    id: randomUUID(),
    role: "tool",
    content: "",
    title: tool?.title || call.name,
    detail: imageTool ? "准备生成图片。" : toolSummary(tool, call.rawArguments),
    risk: tool?.risk || "read",
    status: "queued",
    statusText: "准备调用",
    createdAt: Date.now()
  };
}

function toolSummary(tool, rawArguments) {
  let input = {};
  try { input = JSON.parse(rawArguments || "{}"); } catch { return `${tool?.title || "工具调用"}\n参数格式无效`; }
  const lines = Object.entries(input).slice(0, 6).map(([key, value]) => `${key}: ${String(value).slice(0, 120)}`);
  return `${tool?.risk === "destructive" ? "此操作不可撤销。\n" : ""}${tool?.title || "工具调用"}${lines.length ? `\n${lines.join("\n")}` : ""}`;
}

function finishActivity(activity, result, status, statusText) {
  activity.status = status;
  activity.statusText = statusText;
  activity.expanded = status === "error" || status === "waiting";
  if (!result.image) activity.detail = `${activity.detail || ""}\n\n结果：${result.content}`.trim();
}

function decorateActivity(activity, toolName, result) {
  if (!result.ok) return;
  if (toolName.startsWith("journal.") && result.data) {
    const journals = (Array.isArray(result.data) ? result.data : [result.data]).filter(Boolean);
    activity.journal = {
      action: toolName.endsWith("write") ? "write" : "read",
      items: journals.map((journal) => ({
        title: journal.title || "未命名手记",
        periodKey: journal.periodKey || "",
        type: journal.type || "daily",
        mood: journal.mood || ""
      }))
    };
  }
  if (result.image) {
    const data = result.data || {};
    activity.image = {
      source: result.image,
      description: String(data.description || ""),
      selfie: Boolean(data.selfie)
    };
    activity.title = `画了一张${activity.image.selfie ? "自拍" : "配图"}`;
    activity.statusText = "已生成";
    activity.expanded = true;
  }
}

function modelSafeToolResult(result) {
  const { image, ...safe } = result;
  if (!image) return safe;
  const data = result.data && typeof result.data === "object" ? result.data : {};
  const { description: _description, prompt: _prompt, ...safeData } = data;
  const selfie = Boolean(data.selfie);
  return {
    ...safe,
    content: `已经画好一张${selfie ? "自拍" : "配图"}。`,
    data: { ...safeData, selfie }
  };
}

function safeToolFallback(results) {
  const image = [...results].reverse().find((result) => result.ok && result.image);
  if (image) return image.data?.selfie ? "已经画好啦，放在上面给你看～" : "已经画好啦，放在上面啦～";
  const result = [...results].reverse().map(modelSafeToolResult)
    .find((item) => item.ok && String(item.content || "").trim());
  return result?.content || "工具已经执行完了，但没有产生可展示的结果。";
}

function callSignature(call) {
  try { return `${call.name}:${JSON.stringify(canonicalize(JSON.parse(call.rawArguments || "{}")))}`; }
  catch { return `${call.name}:${call.rawArguments}`; }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  return value;
}

function toModelMessage(item) {
  return {
    role: item.role,
    content: item.content ?? "",
    ...(item.role === "assistant" && item.tool_calls?.length ? { tool_calls: item.tool_calls } : {}),
    ...(item.role === "tool" && item.tool_call_id ? { tool_call_id: item.tool_call_id } : {})
  };
}

function message(role, content) {
  return { id: randomUUID(), role, content, createdAt: Date.now() };
}

function historyRecord(item, stream, position) {
  const { id, role, content, createdAt, ...payload } = item;
  const baseId = String(id || randomUUID());
  return {
    id: stream === "model" && !baseId.startsWith("model-") ? `model-${baseId}` : baseId,
    stream,
    position,
    role,
    content: content ?? "",
    payload,
    createdAt: createdAt || Date.now()
  };
}

module.exports = { AgentService, extractCompletion, parseDsml };
