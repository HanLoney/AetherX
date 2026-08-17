import { describe, expect, it, vi } from "vitest";
import {
  detectReachablePairingServer,
  parseCompletePairingCode,
  runCompletePairing
} from "./complete-pairing";

function createLegacyCode() {
  const payload = {
    version: 1,
    client: {
      serverUrl: "https://hub.example.com",
      id: "client-pair-1",
      secret: "c".repeat(43),
      expiresAt: Date.now() + 60_000
    },
    hub: {
      protocolVersion: 1,
      schemaVersion: 42,
      sessionId: "hub-pair-1",
      secret: "h".repeat(43)
    }
  };
  return `aetherx://complete-pair?payload=${Buffer.from(JSON.stringify(payload), "utf8").toString("base64url")}`;
}

function createCode() {
  const query = new URLSearchParams({
    v: "2",
    c: "client-pair-1",
    cs: "c".repeat(43),
    h: "hub-pair-1",
    hs: "h".repeat(43),
    e: String(Date.now() + 60_000)
  });
  query.append("s", "http://127.0.0.1:4318");
  query.append("s", "http://192.168.1.20:4318");
  query.append("s", "https://hub.example.com");
  return `aetherx://complete-pair?${query}`;
}

describe("complete device pairing", () => {
  it("splits one desktop code into client and Local Hub payloads", () => {
    const bundle = parseCompletePairingCode(createCode());
    expect(JSON.parse(bundle!.clientCode)).toMatchObject({ id: "client-pair-1" });
    expect(bundle!.serverUrls).toEqual([
      "http://127.0.0.1:4318",
      "http://192.168.1.20:4318",
      "https://hub.example.com"
    ]);
    expect(JSON.parse(bundle!.hubCode)).toMatchObject({
      version: 2,
      serverUrls: bundle!.serverUrls,
      sessionId: "hub-pair-1"
    });
  });

  it("keeps the original embedded complete pairing code compatible", () => {
    const bundle = parseCompletePairingCode(createLegacyCode());
    expect(JSON.parse(bundle!.clientCode)).toMatchObject({ id: "client-pair-1" });
    expect(JSON.parse(bundle!.hubCode)).toMatchObject({ sessionId: "hub-pair-1" });
  });

  it("submits both pairing requests from one scan", async () => {
    const pairClient = vi.fn().mockResolvedValue(undefined);
    const pairHub = vi.fn().mockResolvedValue(undefined);
    const probeServer = vi.fn(async (serverUrl: string) => {
      if (serverUrl !== "https://hub.example.com") throw new Error("unreachable");
    });

    await expect(runCompletePairing(createCode(), { pairClient, pairHub, probeServer })).resolves.toBe(true);
    expect(pairClient).toHaveBeenCalledOnce();
    expect(JSON.parse(pairClient.mock.calls[0][0])).toMatchObject({ serverUrl: "https://hub.example.com" });
    expect(pairHub).toHaveBeenCalledOnce();
    expect(JSON.parse(pairHub.mock.calls[0][0]).serverUrls[0]).toBe("https://hub.example.com");
  });

  it("selects the first reachable candidate without asking the user for an address", async () => {
    const probe = vi.fn(async (serverUrl: string) => {
      if (serverUrl !== "http://192.168.1.20:4318") throw new Error("offline");
    });
    await expect(detectReachablePairingServer([
      "http://127.0.0.1:4318",
      "http://192.168.1.20:4318"
    ], probe)).resolves.toBe("http://192.168.1.20:4318");
  });

  it("returns one transport-aware diagnostic when all candidates fail", async () => {
    await expect(detectReachablePairingServer(
      ["http://127.0.0.1:4318", "https://hub.example.com"],
      async () => { throw new Error("offline"); }
    )).rejects.toThrow("已尝试局域网和 Anywhere");
  });

  it("leaves legacy one-purpose pairing codes untouched", async () => {
    const pairClient = vi.fn();
    const pairHub = vi.fn();
    await expect(runCompletePairing("aetherx://pair?id=legacy", { pairClient, pairHub })).resolves.toBe(false);
    expect(pairClient).not.toHaveBeenCalled();
    expect(pairHub).not.toHaveBeenCalled();
  });
});
