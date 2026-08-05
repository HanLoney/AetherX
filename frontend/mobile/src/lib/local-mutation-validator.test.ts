import { describe, expect, it } from "vitest";
import { validateLocalMutation, validateLocalMutations } from "./local-mutation-validator";

describe("Android Local Hub mutation model", () => {
  it("accepts a valid atomic wallet opening batch", () => {
    const now = Date.now();
    expect(() => validateLocalMutations([
      {
        entityType: "wallet_accounts",
        entityId: "account-1",
        payload: {
          id: "account-1", name: "旅行基金", balance_minor: 12_345,
          currency: "CNY", note: "", created_at: now, updated_at: now
        }
      },
      {
        entityType: "wallet_transactions",
        entityId: "transaction-1",
        payload: {
          id: "transaction-1", account_id: "account-1", event_type: "create",
          change_minor: 12_345, balance_before_minor: 0, balance_after_minor: 12_345,
          previous_currency: "CNY", currency: "CNY", detail: "初始余额",
          source: "chat", created_at: now
        }
      }
    ])).not.toThrow();
  });

  it("rejects invalid todo ranges before SQLite accepts them", () => {
    expect(() => validateLocalMutation({
      entityType: "todos",
      entityId: "todo-1",
      payload: {
        id: "todo-1", text: "无效时间", start_at: 200, end_at: 100,
        completed: false, created_at: 1, updated_at: 1
      }
    })).toThrowError(expect.objectContaining({ code: "LOCAL_MUTATION_INVALID" }));
  });

  it("rejects broken wallet balance chains", () => {
    expect(() => validateLocalMutation({
      entityType: "wallet_transactions",
      entityId: "transaction-1",
      payload: {
        id: "transaction-1", account_id: "account-1", event_type: "deposit",
        change_minor: 500, balance_before_minor: 1000, balance_after_minor: 1200,
        previous_currency: "CNY", currency: "CNY", detail: "收入",
        source: "chat", created_at: 1
      }
    })).toThrowError(/前后余额不一致/);
  });

  it("rejects oversized message payloads and malformed profile images", () => {
    expect(() => validateLocalMutation({
      entityType: "messages",
      entityId: "message-1",
      payload: {
        id: "message-1", conversation_id: "conversation-1", stream_type: "display",
        position: 0, role: "assistant", content: "ok", payload: { data: "x".repeat(1_000_001) },
        created_at: 1
      }
    })).toThrowError(/超出允许大小/);

    expect(() => validateLocalMutation({
      entityType: "user_profiles",
      entityId: "profile",
      payload: {
        display_name: "洛尼", preferred_name: "洛尼", birthday: "", bio: "", occupation: "",
        goals: [], avatar_data_url: "data:text/plain;base64,SGVsbG8=", updated_at: 1
      }
    })).toThrowError(/Data URL/);
  });

  it("validates extension status and media identity metadata", () => {
    expect(() => validateLocalMutation({
      entityType: "assistant_dreams",
      entityId: "dream-1",
      payload: {
        id: "dream-1", dream_date: "2026-08-01", title: "梦", content: "内容",
        mood: "平静", symbols: [], reality_note: "虚构内容", source_from: 1,
        source_to: 2, status: "candidate", created_at: 1, updated_at: 1
      }
    })).toThrowError(/status/);

    expect(() => validateLocalMutation({
      entityType: "media_assets",
      entityId: "media-1",
      payload: {
        id: "media-1", mime_type: "image/png", file_name: "media-1.png",
        byte_size: 5, content_hash: "a".repeat(64), created_at: 1
      }
    })).not.toThrow();
  });
});
