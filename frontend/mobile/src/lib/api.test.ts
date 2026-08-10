import { afterEach, describe, expect, it, vi } from "vitest";
import { AetherApi, hydrateMediaSources, normalizeServerUrl } from "./api";
import { parsePairingCode } from "../stores/session";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("normalizeServerUrl", () => {
  it("normalizes a valid server url", () => {
    expect(normalizeServerUrl(" https://api.aetherx.tech/// ")).toBe("https://api.aetherx.tech");
  });

  it("rejects non-http protocols", () => {
    expect(normalizeServerUrl("file:///tmp/aetherx")).toBe("");
  });

  it("allows private LAN and Tailscale HTTP endpoints", () => {
    expect(normalizeServerUrl("http://192.168.1.20:4318/path")).toBe("http://192.168.1.20:4318");
    expect(normalizeServerUrl("http://100.72.4.9:4318")).toBe("http://100.72.4.9:4318");
  });

  it("rejects public cleartext HTTP endpoints", () => {
    expect(normalizeServerUrl("http://203.0.113.8:4318")).toBe("");
    expect(normalizeServerUrl("http://hub.example.com")).toBe("");
    expect(normalizeServerUrl("http://fcloud.example.com")).toBe("");
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

describe("Hub Router", () => {
  it("hands the session to the active Hub and retries a write with the same request id", async () => {
    vi.stubGlobal("window", {
      setTimeout,
      clearTimeout
    });
    const requests: Array<{ url: string; requestId: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const headers = new Headers(init?.headers);
      requests.push({ url, requestId: headers.get("X-Request-Id") || "" });
      if (url === "https://old-hub.example/api/v1/todos") {
        return new Response(JSON.stringify({
          error: { code: "HUB_NOT_ACTIVE", message: "请切换 Hub" }
        }), { status: 409, headers: { "Content-Type": "application/json" } });
      }
      if (url === "https://old-hub.example/api/v1/cluster/session-handoff") {
        return new Response(JSON.stringify({ data: {
          handedOff: true,
          serverUrl: "https://new-hub.example",
          token: "new-token",
          user: { id: "target-user", username: "loney", displayName: "洛尼" },
          spaceId: "space-1",
          nodeId: "new-hub",
          activeNodeId: "new-hub",
          epoch: 2
        } }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ data: {
        id: "todo-1",
        text: "自动换线后写入",
        startAt: 1,
        endAt: 2,
        completed: false,
        createdAt: 1,
        updatedAt: 1
      } }), { status: 201, headers: { "Content-Type": "application/json" } });
    }));
    const changed = vi.fn();
    const api = new AetherApi({
      baseUrl: "https://old-hub.example",
      token: "old-token",
      onConnectionChanged: changed
    });
    const todo = await api.createTodo({ text: "自动换线后写入", startAt: 1, endAt: 2 });
    expect(todo.id).toBe("todo-1");
    expect(api.serverUrl).toBe("https://new-hub.example");
    expect(api.accessToken).toBe("new-token");
    expect(changed).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: "https://new-hub.example",
      nodeId: "new-hub",
      epoch: 2
    }));
    expect(requests.map((item) => item.url)).toEqual([
      "https://old-hub.example/api/v1/todos",
      "https://old-hub.example/api/v1/cluster/session-handoff",
      "https://new-hub.example/api/v1/todos"
    ]);
    expect(requests[0].requestId).toBeTruthy();
    expect(requests[2].requestId).toBe(requests[0].requestId);
  });
});
