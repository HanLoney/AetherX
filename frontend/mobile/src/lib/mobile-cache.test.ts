import { describe, expect, it } from "vitest";
import { compactJournal, mobileDataCacheKey, removeAuthenticatedMediaUrls } from "./mobile-cache";

describe("mobile data cache", () => {
  it("isolates cached data by server and user", () => {
    expect(mobileDataCacheKey("https://one.example|user-a"))
      .not.toBe(mobileDataCacheKey("https://one.example|user-b"));
  });

  it("does not persist authenticated media urls", () => {
    expect(removeAuthenticatedMediaUrls({
      mediaId: "media-1",
      source: "https://hub/media-1?access_token=secret",
      originalSource: "https://hub/media-1?access_token=secret",
      description: "一张照片"
    })).toEqual({ mediaId: "media-1", description: "一张照片" });
  });

  it("keeps only a lightweight journal preview in Preferences", () => {
    const compact = compactJournal({
      id: "journal-1",
      type: "daily",
      periodKey: "2026-08-18",
      title: "手记",
      content: `开头![](data:image/png;base64,${"a".repeat(5_000)})结尾${"正文".repeat(2_000)}`,
      mood: "安心",
      sourceFrom: 1,
      sourceTo: 2,
      sourceMessageCount: 1,
      createdAt: 3,
      updatedAt: 4
    });

    expect(compact.content.length).toBeLessThanOrEqual(2_000);
    expect(compact.content).not.toContain("data:image");
  });
});
