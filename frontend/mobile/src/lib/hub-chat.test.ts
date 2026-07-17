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
    expect(api.agentChat).toHaveBeenCalledWith(expect.objectContaining({ content: "在吗" }));
    expect(response.displayMessages.at(-1)?.content).toBe("完成啦");
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
