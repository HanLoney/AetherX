import { describe, expect, it } from "vitest";
import { loadJournalCache, peekJournalCache, saveJournalCache } from "./journal-cache";
import type { AetherApi, Journal } from "./api";

function journal(id: string, content = "完整正文"): Journal {
  return {
    id,
    type: "daily",
    periodKey: "2026-08-18",
    title: "缓存手记",
    content,
    mood: "安心",
    sourceFrom: 1,
    sourceTo: 2,
    sourceMessageCount: 2,
    createdAt: 3,
    updatedAt: 4
  };
}

describe("journal cache", () => {
  it("keeps full journal bodies in the dedicated cache", async () => {
    await saveJournalCache("HTTPS://HUB|USER", [journal("journal-1")]);

    expect(peekJournalCache("https://hub|user")?.journals[0]?.content).toBe("完整正文");
    const cached = await loadJournalCache("https://hub|user", {
      serverUrl: "https://hub",
      accessToken: "token"
    } as AetherApi);
    expect(cached?.journals[0]?.id).toBe("journal-1");
  });
});
