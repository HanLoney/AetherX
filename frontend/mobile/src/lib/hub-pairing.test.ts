import { describe, expect, it, vi } from "vitest";
import {
  canonicalStringify,
  pairAndroidLocalHub,
  parseHubPairingCode,
  parseHubPairingReference,
  resolveHubPairingCode
} from "./hub-pairing";

describe("Android Local Hub pairing", () => {
  const createPayload = () => ({
      protocolVersion: 1,
      schemaVersion: 39,
      spaceId: "space-1",
      sourceNodeId: "node-desktop",
      sessionId: "pair-1",
      secret: "s".repeat(43),
      serverEphemeralPublicKey: "public-key",
      endpoints: [{
        transport: "anywhere",
        address: "https://desktop.example.ts.net:4318/",
        priority: 200,
        certificateFingerprint: "fingerprint"
      }],
      expiresAt: Date.now() + 60_000
    });

  const encodePayload = (payload: unknown) => Buffer
    .from(JSON.stringify(payload), "utf8")
    .toString("base64url");

  it("parses the desktop Hub pairing payload without dropping endpoint identity", () => {
    const payload = createPayload();
    expect(parseHubPairingCode(JSON.stringify(payload))).toMatchObject({
      spaceId: "space-1",
      sourceNodeId: "node-desktop",
      endpoints: [{
        transport: "anywhere",
        address: "https://desktop.example.ts.net:4318",
        priority: 200
      }]
    });
  });

  it("parses the complete desktop pairing URI", () => {
    const payload = createPayload();
    expect(parseHubPairingCode(`aetherx://hub-pair?payload=${encodePayload(payload)}`))
      .toMatchObject({ sessionId: "pair-1", spaceId: "space-1" });
  });

  it("unwraps a JSON-stringified URI and scanner result object", () => {
    const uri = `aetherx://hub-pair?payload=${encodePayload(createPayload())}`;
    expect(parseHubPairingCode(JSON.stringify(uri))).toMatchObject({ sessionId: "pair-1" });
    expect(parseHubPairingCode(JSON.stringify({ ScanResult: `\n${uri}\n` })))
      .toMatchObject({ sessionId: "pair-1" });
  });

  it("parses a bare Base64URL payload", () => {
    expect(parseHubPairingCode(encodePayload(createPayload())))
      .toMatchObject({ sessionId: "pair-1", sourceNodeId: "node-desktop" });
  });

  it("parses a compact v2 Hub pairing reference", () => {
    const query = new URLSearchParams({
      v: "2",
      s: "http://192.168.1.20:4318",
      i: "pair-1",
      k: "s".repeat(43),
      e: String(Date.now() + 60_000)
    });
    query.append("s", "https://desktop.example.ts.net:4318");
    expect(parseHubPairingReference(`aetherx://hub-pair?${query}`)).toMatchObject({
      version: 2,
      serverUrls: [
        "http://192.168.1.20:4318",
        "https://desktop.example.ts.net:4318"
      ],
      sessionId: "pair-1"
    });
  });

  it("resolves compact references before parsing the original payload", async () => {
    const reference = JSON.stringify({
      version: 2,
      serverUrl: "https://hub.example.com",
      sessionId: "pair-1",
      secret: "s".repeat(43),
      expiresAt: Date.now() + 60_000
    });
    await expect(resolveHubPairingCode(reference, async (parsed) => ({
      ...createPayload(),
      sessionId: parsed.sessionId,
      secret: parsed.secret
    }))).resolves.toMatchObject({ sessionId: "pair-1", spaceId: "space-1" });
  });

  it("reuses an already configured Local Hub in the same Space", async () => {
    const states: string[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ data: { status: "ok", service: "aetherx-backend" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/api/v1/hub-pairing/sessions/pair-1/reuse")) {
        expect(JSON.parse(String(init?.body))).toEqual({
          secret: "s".repeat(43),
          nodeId: "mobile-node-existing"
        });
        return new Response(JSON.stringify({
          data: { status: "redeemed", reused: true, nodeId: "mobile-node-existing" }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    try {
      const result = await pairAndroidLocalHub(
        JSON.stringify(createPayload()),
        {
          status: {
            value: { nodeId: "mobile-node-stale", configured: false, spaceId: "" }
          },
          refresh: vi.fn().mockResolvedValue({
            nodeId: "mobile-node-existing",
            localNodeId: "mobile-node-existing",
            configured: true,
            spaceId: "space-1",
            bootstrap: { status: "completed" }
          })
        } as any,
        (state) => states.push(state)
      );
      expect(result).toMatchObject({
        reused: true,
        spaceId: "space-1",
        localNodeId: "mobile-node-existing"
      });
      expect(states).toContain("手机 Hub 已连接，正在恢复手机客户端登录…");
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("resumes an incomplete Local Hub replica after reusing its node", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/health")) {
        return new Response(JSON.stringify({ data: { status: "ok", service: "aetherx-backend" } }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      if (url.endsWith("/api/v1/hub-pairing/sessions/pair-1/reuse")) {
        return new Response(JSON.stringify({
          data: { status: "redeemed", reused: true, nodeId: "mobile-node-existing" }
        }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      }
      throw new Error(`unexpected request: ${url}`);
    });
    const refresh = vi.fn()
      .mockResolvedValueOnce({
        nodeId: "mobile-node-existing",
        localNodeId: "mobile-node-existing",
        configured: true,
        spaceId: "space-1",
        bootstrap: null
      })
      .mockResolvedValueOnce({
        nodeId: "mobile-node-existing",
        localNodeId: "mobile-node-existing",
        configured: true,
        spaceId: "space-1",
        bootstrap: { status: "completed" }
      });
    const resume = vi.fn().mockResolvedValue({ completed: true });
    vi.stubGlobal("fetch", fetchMock);
    try {
      await expect(pairAndroidLocalHub(
        JSON.stringify(createPayload()),
        { status: { value: null }, refresh, resume } as any
      )).resolves.toMatchObject({ reused: true, localNodeId: "mobile-node-existing" });
      expect(resume).toHaveBeenCalledOnce();
      expect(refresh).toHaveBeenCalledTimes(2);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not replace a Local Hub that belongs to another Space", async () => {
    await expect(pairAndroidLocalHub(
      JSON.stringify(createPayload()),
      {
        status: {
          value: { nodeId: "mobile-node-existing", configured: true, spaceId: "space-other" }
        },
        refresh: vi.fn().mockResolvedValue({
          nodeId: "mobile-node-existing",
          configured: true,
          spaceId: "space-other",
          bootstrap: { status: "completed" }
        })
      } as any
    )).rejects.toThrow("已连接到另一个数据空间");
  });

  it("returns a stable Chinese error for invalid scanner content", () => {
    expect(() => parseHubPairingCode("aetherx://not-a-hub-code"))
      .toThrow("手机 Hub 配对码无法识别，请重新生成后扫描或粘贴。");
  });

  it("uses the same recursively sorted canonical JSON shape as the Node Hub", () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, x: [3, { b: true, a: null }] } }))
      .toBe('{"a":{"x":[3,{"a":null,"b":true}],"y":2},"z":1}');
  });
});
