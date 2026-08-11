import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/app", () => ({
  App: {
    getLaunchUrl: vi.fn(async () => undefined),
    addListener: vi.fn(async () => ({ remove: vi.fn() }))
  }
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) }
}));

import {
  normalizePairingDeepLink,
  takePendingPairingCode
} from "./pairing-deep-link";

describe("pairing deep links", () => {
  beforeEach(() => {
    takePendingPairingCode();
  });

  it("accepts only integrated pairing links", () => {
    expect(normalizePairingDeepLink(" aetherx://complete-pair?v=2&c=client "))
      .toBe("aetherx://complete-pair?v=2&c=client");
    expect(normalizePairingDeepLink("aetherx://pair?id=legacy")).toBe("");
    expect(normalizePairingDeepLink("https://example.com")).toBe("");
  });
});
