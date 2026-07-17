import type { ChatMessage } from "./api";
import { parseToolProtocol } from "./tool-protocol";

export function normalizeStoredDisplayMessages(messages: ChatMessage[]) {
  return messages.flatMap((message) => {
    if (message.role !== "assistant" || typeof message.content !== "string") return [message];
    const parsed = parseToolProtocol(message.content);
    if (!parsed.calls.length) return [message];
    return [{ ...message, content: parsed.content || "这条历史回复曾包含未执行的工具请求。" }];
  });
}
