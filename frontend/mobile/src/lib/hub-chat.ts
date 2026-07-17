import type { AetherApi, AgentChatResult, ChatMessage, Conversation } from "./api";

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
      displayMessages: result.displayMessages,
      toolMutated
    };
  }
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
