import { describe, expect, it, vi } from "vitest";
import type { AetherApi, AgentChatResult } from "./api";
import { MobileChat } from "./hub-chat";

function result(status: AgentChatResult["status"]): AgentChatResult {
  return {
    status,
    runId: status === "approval_required" ? "run-1" : null,
    conversation: { id: "conversation-1", title: "测试", summary: "", createdAt: 1, updatedAt: 1 },
    displayMessages: status === "approval_required"
      ? [{ id: "activity-1", role: "tool", content: "", status: "waiting" }]
      : [{ id: "assistant-1", role: "assistant", content: "完成啦" }],
    toolMutated: status === "completed",
    pendingApproval: status === "approval_required" ? { activityId: "activity-1" } : null
  };
}

describe("MobileChat Agent Hub client", () => {
  it("sends only the user request and renders the server-owned result", async () => {
    const api = {
      agentChat: vi.fn(async () => result("completed")),
      approveAgentRun: vi.fn()
    } as unknown as AetherApi;
    const response = await new MobileChat(api).send({
      conversation: null,
      displayMessages: [],
      content: "在吗"
    });
    expect(api.agentChat).toHaveBeenCalledWith(expect.objectContaining({ content: "在吗", responseMode: "delta" }));
    expect(response.displayMessages.at(-1)?.content).toBe("完成啦");
  });

  it("merges a delta response into locally cached history", async () => {
    const api = {
      agentChat: vi.fn(async () => result("completed")),
      approveAgentRun: vi.fn()
    } as unknown as AetherApi;
    const response = await new MobileChat(api).send({
      conversation: null,
      displayMessages: [{ id: "old", role: "user", content: "旧消息" }],
      content: "继续"
    });

    expect(response.displayMessages.map((message) => message.id)).toEqual(["old", "assistant-1"]);
  });

  it("places an unpositioned delta after the highest cached position instead of the deduped count", async () => {
    const api = {
      agentChat: vi.fn(async () => result("completed")),
      approveAgentRun: vi.fn()
    } as unknown as AetherApi;
    const response = await new MobileChat(api).send({
      conversation: null,
      displayMessages: [
        { id: "old-a", position: 0, role: "user", content: "旧消息 A", createdAt: 1 },
        { id: "old-b", position: 9, role: "assistant", content: "旧消息 B", createdAt: 2 }
      ],
      content: "继续"
    });

    expect(response.displayMessages.find((message) => message.id === "assistant-1")?.position).toBe(10);
  });

  it("preserves authoritative positions returned by the Hub", async () => {
    const completed = result("completed");
    completed.displayMessages[0].position = 23;
    const api = {
      agentChat: vi.fn(async () => completed),
      approveAgentRun: vi.fn()
    } as unknown as AetherApi;
    const response = await new MobileChat(api).send({
      conversation: null,
      displayMessages: [{ id: "old", position: 9, role: "user", content: "旧消息", createdAt: 1 }],
      content: "继续"
    });

    expect(response.displayMessages.find((message) => message.id === "assistant-1")?.position).toBe(23);
  });

  it("returns write approval decisions to the same Hub run", async () => {
    const api = {
      agentChat: vi.fn(async () => result("approval_required")),
      approveAgentRun: vi.fn(async () => result("completed"))
    } as unknown as AetherApi;
    const requestApproval = vi.fn(async () => true);
    const response = await new MobileChat(api).send({
      conversation: null,
      displayMessages: [],
      content: "帮我建个待办",
      requestApproval
    });
    expect(requestApproval).toHaveBeenCalledWith(expect.objectContaining({ id: "activity-1" }));
    expect(api.approveAgentRun).toHaveBeenCalledWith("run-1", true);
    expect(response.toolMutated).toBe(true);
  });
});
