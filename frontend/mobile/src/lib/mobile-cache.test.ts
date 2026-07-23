import { describe, expect, it } from "vitest";
import { mobileDataCacheKey, removeAuthenticatedMediaUrls } from "./mobile-cache";

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
});
