import type { AetherApi, AgentChatResult, ChatMessage, Conversation } from "./api";
import {
  dedupeConversationMessages,
  normalizeMessagePositions
} from "./conversation-cache";

export interface MobileChatInput {
  conversation: Conversation | null;
  displayMessages: ChatMessage[];
  content: string;
  onActivity?: (activity: ChatMessage) => void;
  requestApproval?: (activity: ChatMessage) => Promise<boolean>;
}

export class MobileChat {
  constructor(private readonly api: AetherApi) {}

  async send(input: MobileChatInput) {
    let result = await this.api.agentChat({
      ...(input.conversation?.id ? { conversationId: input.conversation.id } : {}),
      content: input.content,
      responseMode: "delta",
      runtime: runtimeOptions()
    });
    let toolMutated = result.toolMutated;

    while (result.status === "approval_required" && result.runId) {
      notifyActivities(input, result);
      const activity = pendingActivity(result);
      const approved = activity && input.requestApproval
        ? await input.requestApproval(activity)
        : false;
      result = await this.api.approveAgentRun(result.runId, approved);
      toolMutated ||= result.toolMutated;
    }

    return {
      conversation: result.conversation,
      displayMessages: mergeMessages(input.displayMessages, result.displayMessages),
      toolMutated
    };
  }
}

function mergeMessages(current: ChatMessage[], delta: ChatMessage[]) {
  const positionedCurrent = normalizeMessagePositions(current);
  const highestPosition = positionedCurrent.reduce(
    (highest, message) => Number.isSafeInteger(Number(message.position))
      ? Math.max(highest, Number(message.position))
      : highest,
    -1
  );
  const positionedDelta = delta.map((message, index) => ({
    ...message,
    position: Number.isSafeInteger(Number(message.position))
      ? Number(message.position)
      : highestPosition + index + 1
  }));
  const byId = new Map<string, ChatMessage>();
  for (const [index, message] of [...positionedCurrent, ...positionedDelta].entries()) {
    byId.set(message.id || `message:${index}`, message);
  }
  return dedupeConversationMessages([...byId.values()]);
}

function pendingActivity(result: AgentChatResult) {
  const id = result.pendingApproval?.activityId;
  return result.displayMessages.find((message) => message.id === id && message.role === "tool");
}

function notifyActivities(input: MobileChatInput, result: AgentChatResult) {
  const knownIds = new Set(input.displayMessages.map((message) => message.id).filter(Boolean));
  for (const message of result.displayMessages) {
    if ((message.role === "tool" || message.role === "memory") && !knownIds.has(message.id)) {
      input.onActivity?.({ ...message });
    }
  }
}

function runtimeOptions() {
  return {
    timeAwareness: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language
  };
}
