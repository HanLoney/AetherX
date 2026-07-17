import { describe, expect, it } from "vitest";
import { normalizeServerUrl } from "./api";
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
