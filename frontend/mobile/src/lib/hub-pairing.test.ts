import { describe, expect, it } from "vitest";
import { canonicalStringify, parseHubPairingCode } from "./hub-pairing";

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

  it("returns a stable Chinese error for invalid scanner content", () => {
    expect(() => parseHubPairingCode("aetherx://not-a-hub-code"))
      .toThrow("手机 Hub 配对码无法识别，请重新生成后扫描或粘贴。");
  });

  it("uses the same recursively sorted canonical JSON shape as the Node Hub", () => {
    expect(canonicalStringify({ z: 1, a: { y: 2, x: [3, { b: true, a: null }] } }))
      .toBe('{"a":{"x":[3,{"a":null,"b":true}],"y":2},"z":1}');
  });
});
