import { describe, expect, it } from "vitest";
import { isProxy, reactive } from "vue";
import {
  dedupeConversationMessages,
  loadLatestConversationCache,
  mergeConversationTail,
  normalizeMessagePositions,
  peekConversationCache,
  peekLatestConversationCache,
  saveConversationCache
} from "./conversation-cache";
import type { ChatMessage } from "./api";

function message(id: string | undefined, position: number | undefined, content: string): ChatMessage {
  return { id, position, role: "assistant", content, createdAt: position };
}

describe("conversation cache merging", () => {
  it("replaces the overlapping tail and keeps older cached messages", () => {
    const cached = [
      message("message-0", 0, "old 0"),
      message("message-1", 1, "old 1"),
      message("message-2", 2, "stale 2")
    ];
    const received = [
      message("message-2", 2, "fresh 2"),
      message("message-3", 3, "fresh 3")
    ];

    expect(mergeConversationTail(cached, received, 1).map((item) => item.content)).toEqual([
      "old 0",
      "old 1",
      "fresh 2",
      "fresh 3"
    ]);
  });

  it("preserves legacy messages without ids while assigning stable positions", () => {
    const normalized = normalizeMessagePositions([
      message(undefined, undefined, "legacy 0"),
      message(undefined, undefined, "legacy 1")
    ]);

    expect(normalized.map((item) => item.position)).toEqual([0, 1]);
    expect(mergeConversationTail(normalized, [], 1).map((item) => item.content)).toEqual([
      "legacy 0",
      "legacy 1"
    ]);
  });

  it("keeps a synchronous memory copy after persisting a conversation", async () => {
    const conversation = { id: "conversation-memory", title: "聊天", summary: "", createdAt: 1, updatedAt: 2 };
    const messages = [message("message-memory", 0, "缓存消息")];

    await saveConversationCache("scope-memory", conversation, messages);

    expect(peekConversationCache("scope-memory", conversation.id)?.messages).toEqual(messages);
  });

  it("finds the latest cached conversation by account scope without a conversation id", async () => {
    const older = { id: "conversation-older", title: "旧聊天", summary: "", createdAt: 1, updatedAt: 2 };
    const latest = { id: "conversation-latest", title: "新聊天", summary: "", createdAt: 3, updatedAt: 4 };

    await saveConversationCache("SCOPE-LATEST", older, [message("older", 0, "旧消息")]);
    await saveConversationCache("scope-latest", latest, [message("latest", 0, "新消息")]);

    expect(peekLatestConversationCache("scope-latest")?.conversationId).toBe(latest.id);
    expect((await loadLatestConversationCache("SCOPE-LATEST"))?.messages[0]?.content).toBe("新消息");
  });

  it("converts Vue proxies into IndexedDB-safe plain snapshots", async () => {
    const conversation = reactive({
      id: "conversation-proxy",
      title: "响应式聊天",
      summary: "",
      createdAt: 1,
      updatedAt: 2
    });
    const messages = reactive([message("message-proxy", 0, "响应式消息")]);

    expect(isProxy(conversation)).toBe(true);
    expect(isProxy(messages)).toBe(true);
    await saveConversationCache("scope-proxy", conversation, messages);

    const cached = peekConversationCache("scope-proxy", conversation.id);
    expect(isProxy(cached?.conversation)).toBe(false);
    expect(isProxy(cached?.messages)).toBe(false);
    expect(cached?.messages[0]?.content).toBe("响应式消息");
  });

  it("removes an adjacent cross-device duplicate with a different id", () => {
    const duplicate = [
      { ...message("assistant-a", 12, "同一条回复"), createdAt: 1000 },
      { ...message("assistant-b", 13, "同一条回复"), createdAt: 1800 }
    ];

    expect(dedupeConversationMessages(duplicate).map((item) => item.id)).toEqual([
      "assistant-a"
    ]);
  });

  it("keeps a newly created turn at the end when imported positions contain gaps", () => {
    const messages = [
      { ...message("new-user", 2143, "试试"), role: "user" as const, createdAt: 3000 },
      { ...message("new-assistant", 2145, "新回复"), createdAt: 4000 },
      { ...message("old-user", 2147, "真的假的"), role: "user" as const, createdAt: 1000 },
      { ...message("old-assistant", 2149, "旧回复"), createdAt: 2000 }
    ];

    expect(dedupeConversationMessages(messages).map((item) => item.content)).toEqual([
      "真的假的",
      "旧回复",
      "试试",
      "新回复"
    ]);
  });
});
