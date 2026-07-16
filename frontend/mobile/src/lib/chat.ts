import type { AetherApi, ChatMessage, Conversation } from "./api";

const FALLBACK_PROMPT = "你是用户熟悉且可信赖的数字伙伴。自然、真诚地回应，不使用客服套话；只有用户要求教程或分析时才使用结构化回答。";

export class MobileChat {
  constructor(private readonly api: AetherApi) {}

  async send(input: { conversation: Conversation | null; displayMessages: ChatMessage[]; modelMessages: ChatMessage[]; content: string }) {
    const now = Date.now();
    const userMessage: ChatMessage = { id: crypto.randomUUID(), role: "user", content: input.content, createdAt: now };
    const conversation = input.conversation || await this.api.createConversation(input.content.slice(0, 36));
    let memoryContext = "";
    try { memoryContext = (await this.api.recallMemories(input.content)).context || ""; } catch { /* 召回失败不阻断聊天 */ }
    const prompt = await this.api.promptSettings().then((bundle) => bundle.compiledPrompt || FALLBACK_PROMPT).catch(() => FALLBACK_PROMPT);
    const system = [prompt, memoryContext].filter(Boolean).join("\n\n");
    const requestMessages = [
      { role: "system", content: system },
      ...input.modelMessages.filter((message) => message.role !== "system").slice(-30).map(({ role, content }) => ({ role, content })),
      { role: "user", content: input.content }
    ];
    const result = await this.api.requestAi({
      runtime: { timeAwareness: true, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, locale: navigator.language },
      messages: requestMessages,
      tools: []
    });
    const content = extractAssistantText(result);
    const assistantMessage: ChatMessage = { id: crypto.randomUUID(), role: "assistant", content, createdAt: Date.now() };
    const displayMessages = [...input.displayMessages, userMessage, assistantMessage];
    const modelMessages = [...input.modelMessages, userMessage, assistantMessage];
    await this.api.saveMessages(conversation.id, [
      record(userMessage, "display", displayMessages.length - 2),
      record(assistantMessage, "display", displayMessages.length - 1),
      record(userMessage, "model", modelMessages.length - 2, `model-${userMessage.id}`),
      record(assistantMessage, "model", modelMessages.length - 1, `model-${assistantMessage.id}`)
    ]);
    void this.api.extractMemories({
      userMessage: input.content,
      assistantMessage: content,
      conversationId: conversation.id,
      conversationMessages: modelMessages.slice(-12).map(({ role, content: text }) => ({ role, content: text }))
    }).catch(() => undefined);
    return { conversation, displayMessages, modelMessages };
  }
}

function record(message: ChatMessage, stream: "display" | "model", position: number, id = message.id) {
  return { id, stream, position, role: message.role, content: message.content, payload: {}, createdAt: message.createdAt };
}

export function extractAssistantText(result: Record<string, unknown>) {
  const data = (result.data || result) as Record<string, any>;
  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text ?? data?.output_text;
  if (typeof content === "string" && content.trim()) return sanitize(content);
  if (Array.isArray(content)) {
    const text = content.map((part) => typeof part === "string" ? part : part?.text?.value || part?.text || part?.content || "").join("");
    if (text.trim()) return sanitize(text);
  }
  throw new Error("模型没有返回可读内容，请检查 AI 配置。 ");
}

function sanitize(value: string) {
  return value.replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think\s*>/gi, "").trim();
}
