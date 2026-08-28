import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@capacitor/app", () => ({
  App: { getInfo: vi.fn(async () => ({ version: "1.2.6" })) }
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: vi.fn(() => "android"),
    isNativePlatform: vi.fn(() => true)
  }
}));
vi.mock("@capacitor/device", () => ({
  Device: {
    getInfo: vi.fn(async () => ({
      manufacturer: "Xiaomi",
      model: "Test Phone",
      platform: "android",
      osVersion: "16"
    }))
  }
}));
vi.mock("./storage", () => ({
  loadInstallationId: vi.fn(async () => "installation-1")
}));

import { MobileHealthReporter } from "./device-health";

describe("MobileHealthReporter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("document", {
      visibilityState: "visible",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    });
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("awaits a refreshed network snapshot before sending the heartbeat", async () => {
    const heartbeats: Array<Record<string, unknown>> = [];
    let resolveSnapshot!: (value: Record<string, unknown>) => void;
    const snapshot = new Promise<Record<string, unknown>>((resolve) => {
      resolveSnapshot = resolve;
    });
    const reporter = new MobileHealthReporter(
      {
        analyticsPresence: vi.fn(async (input: Record<string, unknown>) => {
          heartbeats.push(input);
        })
      } as never,
      () => snapshot as never
    );

    reporter.start();
    await Promise.resolve();
    expect(heartbeats).toHaveLength(0);

    resolveSnapshot({
      syncStatus: "online",
      syncCursor: 42,
      sseConnected: true,
      localHubEndpoints: [{
        transport: "tailscale",
        address: "http://100.100.10.20:4319",
        priority: 350
      }]
    });
    await vi.waitFor(() => expect(heartbeats).toHaveLength(1));
    expect(heartbeats[0].localHubEndpoints).toEqual([{
      transport: "tailscale",
      address: "http://100.100.10.20:4319",
      priority: 350
    }]);
    reporter.stop();
  });

  it("keeps reporting liveness when the native Hub snapshot stalls", async () => {
    const analyticsPresence = vi.fn(async () => undefined);
    const reporter = new MobileHealthReporter(
      { analyticsPresence } as never,
      () => new Promise(() => undefined)
    );

    reporter.start();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(analyticsPresence).toHaveBeenCalledWith(expect.objectContaining({
      syncStatus: "idle",
      syncCursor: 0,
      sseConnected: false
    }));
    reporter.stop();
  });
});
