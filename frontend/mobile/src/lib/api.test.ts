import { describe, expect, it } from "vitest";
import { AetherApi, hydrateMediaSources, normalizeServerUrl } from "./api";
import { parsePairingCode } from "../stores/session";

describe("normalizeServerUrl", () => {
  it("normalizes a valid server url", () => {
    expect(normalizeServerUrl(" https://api.aetherx.tech/// ")).toBe("https://api.aetherx.tech");
  });

  it("rejects non-http protocols", () => {
    expect(normalizeServerUrl("file:///tmp/aetherx")).toBe("");
  });
});

describe("parsePairingCode", () => {
  it("reads a desktop pairing url", () => {
    expect(parsePairingCode(`aetherx://pair?server=${encodeURIComponent("https://hub.example.com")}&id=pair-1&secret=${"a".repeat(32)}`)).toMatchObject({
      serverUrl: "https://hub.example.com",
      id: "pair-1",
      secret: "a".repeat(32)
    });
  });
});

describe("hydrateMediaSources", () => {
  it("turns compact media references into authenticated cacheable urls", () => {
    const payload = {
      displayMessages: [{ image: { mediaId: "image one", description: "test" } }]
    };
    hydrateMediaSources(payload, "https://hub.example.com", "session token");
    expect(payload.displayMessages[0].image).toMatchObject({
      mediaId: "image one",
      source: "https://hub.example.com/api/v1/media/image%20one?variant=preview&access_token=session%20token",
      originalSource: "https://hub.example.com/api/v1/media/image%20one?access_token=session%20token"
    });
  });
});

describe("mobile health api", () => {
  it("exposes an authenticated heartbeat method", () => {
    expect(AetherApi.prototype.deviceHeartbeat).toBeTypeOf("function");
  });
});

describe("conversation pagination api", () => {
  it("exposes a paged conversation method", () => {
    expect(AetherApi.prototype.conversationPage).toBeTypeOf("function");
  });
});
