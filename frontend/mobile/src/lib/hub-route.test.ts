import { describe, expect, it } from "vitest";
import { hubRouteCandidates } from "./hub-route";

describe("Hub route candidates", () => {
  it("keeps the current route and adds matching LAN and Anywhere alternatives", () => {
    expect(hubRouteCandidates(
      { nodeId: "desktop", serverUrl: "http://192.168.1.10:4318/" },
      [
        { nodeId: "desktop", address: "https://desktop.example.ts.net:4318", priority: 300 },
        { nodeId: "desktop", address: "http://192.168.1.10:4318", priority: 500 },
        { nodeId: "other", address: "https://other.example.ts.net:4318", priority: 900 }
      ]
    )).toEqual([
      "http://192.168.1.10:4318",
      "https://desktop.example.ts.net:4318"
    ]);
  });

  it("drops invalid and duplicate endpoint values", () => {
    expect(hubRouteCandidates(
      { nodeId: "desktop", serverUrl: "https://desktop.example.ts.net:4318" },
      [
        { address: "not-a-url", priority: 900 },
        { address: "https://desktop.example.ts.net:4318/", priority: 300 }
      ]
    )).toEqual(["https://desktop.example.ts.net:4318"]);
  });
});
