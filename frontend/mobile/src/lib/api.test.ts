import { describe, expect, it } from "vitest";
import { normalizeServerUrl } from "./api";
import { extractAssistantText } from "./chat";
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

describe("extractAssistantText", () => {
  it("reads OpenAI-compatible chat completions", () => {
    expect(extractAssistantText({ choices: [{ message: { content: "在呢喵~" } }] })).toBe("在呢喵~");
  });

  it("removes hidden reasoning blocks", () => {
    expect(extractAssistantText({ choices: [{ message: { content: "<think>secret</think>看这里" } }] })).toBe("看这里");
  });
});
