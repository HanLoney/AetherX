const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { XuanApiClient } = require("../api-client");
const {
  AuthStore,
  selectAuthenticationSession,
  shouldKeepRoutedConnection
} = require("../auth-store");

test("desktop preserves authenticated active-Hub routes without accepting older epochs", () => {
  const previous = {
    spaceId: "space-1",
    activeNodeId: "desktop",
    localNodeId: "desktop",
    epoch: 43
  };
  assert.equal(shouldKeepRoutedConnection({
    spaceId: "space-1",
    activeNodeId: "mobile",
    localNodeId: "mobile",
    epoch: 44
  }, previous), true);
  assert.equal(shouldKeepRoutedConnection({
    spaceId: "space-1",
    activeNodeId: "mobile",
    localNodeId: "mobile",
    epoch: 42
  }, previous), false);
  assert.equal(shouldKeepRoutedConnection({
    spaceId: "space-1",
    activeNodeId: "mobile",
    localNodeId: "desktop",
    epoch: 44
  }, previous), false);
});

test("API client authenticates with a bearer token and never sends a user id header", async () => {
  const originalFetch = global.fetch;
  let capturedHeaders;
  global.fetch = async (_url, options) => {
    capturedHeaders = options.headers;
    return new Response(JSON.stringify({ data: { user: { id: "u1" } } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const client = new XuanApiClient({
      baseUrl: "https://aether.example.com/",
      token: "secret-session-token"
    });
    await client.getSession();
    assert.equal(capturedHeaders.Authorization, "Bearer secret-session-token");
    assert.equal(capturedHeaders["X-Xuan-User-Id"], undefined);
    assert.equal(client.baseUrl, "https://aether.example.com");
  } finally {
    global.fetch = originalFetch;
  }
});

test("API client expands compact media references without embedding image bytes", async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({
    data: { image: { mediaId: "media one", description: "tiny" } }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
  try {
    const client = new XuanApiClient({
      baseUrl: "https://aether.example.com",
      token: "secret token"
    });
    const result = await client.request("GET", "/api/v1/example");
    assert.equal(
      result.image.source,
      "https://aether.example.com/api/v1/media/media%20one?variant=preview&access_token=secret%20token"
    );
    assert.equal(
      result.image.originalSource,
      "https://aether.example.com/api/v1/media/media%20one?access_token=secret%20token"
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("API client hands a write request to the active Hub and preserves its request id", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let connectionChanged = null;
  global.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/api/v1/cluster/session-handoff")) {
      return new Response(JSON.stringify({
        data: {
          handedOff: true,
          serverUrl: "https://active.example.com/",
          token: "active-token",
          user: { id: "u2", username: "luoni", displayName: "洛尼" },
          spaceId: "space-1",
          nodeId: "node-active",
          activeNodeId: "node-active",
          epoch: 2
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).startsWith("https://standby.example.com")) {
      return new Response(JSON.stringify({
        error: { code: "HUB_NOT_ACTIVE", message: "当前 Hub 不是活动节点。" }
      }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: { id: "todo-1" } }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const client = new XuanApiClient({
      baseUrl: "https://standby.example.com",
      token: "standby-token",
      onConnectionChanged: (connection) => { connectionChanged = connection; }
    });
    const result = await client.createTodo({ text: "测试切换" });
    assert.equal(result.id, "todo-1");
    assert.equal(client.baseUrl, "https://active.example.com");
    assert.equal(client.token, "active-token");
    assert.equal(connectionChanged.spaceId, "space-1");
    assert.equal(calls.length, 3);
    assert.ok(calls[0].options.headers["X-Request-Id"]);
    assert.equal(
      calls[0].options.headers["X-Request-Id"],
      calls[2].options.headers["X-Request-Id"]
    );
    assert.notEqual(
      calls[0].options.headers["X-Request-Id"],
      calls[1].options.headers["X-Request-Id"]
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test("API client never takes Hub authority back when the active mobile Hub has no endpoint", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options = {}) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith("/api/v1/cluster/session-handoff")) {
      return new Response(JSON.stringify({
        error: { code: "PEER_ENDPOINT_UNAVAILABLE", message: "对端 Hub 尚未登记连接地址。" }
      }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      error: { code: "HUB_NOT_ACTIVE", message: "请切换 Hub" }
    }), { status: 409, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = new XuanApiClient({
      baseUrl: "http://127.0.0.1:4318",
      token: "desktop-token"
    });
    await assert.rejects(
      () => client.createTodo({ text: "保持手机 Hub", startAt: 1, endAt: 2 }),
      (error) => error.code === "PEER_ENDPOINT_UNAVAILABLE"
    );
    assert.equal(requests.length, 2);
  } finally {
    global.fetch = originalFetch;
  }
});

test("API client reports an unreachable active mobile Hub without mutating authority", async () => {
  const originalFetch = global.fetch;
  let statusRequests = 0;
  global.fetch = async (url) => {
    if (String(url).endsWith("/api/v1/cluster/session-handoff")) {
      return new Response(JSON.stringify({
        error: { code: "PEER_ENDPOINT_UNAVAILABLE", message: "对端 Hub 尚未登记连接地址。" }
      }), { status: 409, headers: { "Content-Type": "application/json" } });
    }
    if (String(url).endsWith("/api/v1/cluster/status")) {
      statusRequests += 1;
      return new Response(JSON.stringify({
        data: {
          localNodeId: "desktop-node",
          activeNodeId: "mobile-node",
          state: "stable",
          epoch: 2
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unexpected request: ${url}`);
  };
  try {
    const client = new XuanApiClient({
      baseUrl: "http://127.0.0.1:4318",
      token: "desktop-token"
    });
    await assert.rejects(
      () => client.ensureActiveHub(),
      (error) => error.code === "PEER_ENDPOINT_UNAVAILABLE"
    );
    assert.equal(statusRequests, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("auth store encrypts the session token before writing it to disk", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aether-auth-store-"));
  const filePath = path.join(directory, "auth.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, "")
  };
  try {
    const store = new AuthStore(filePath, safeStorage);
    store.save({
      serverUrl: "https://aether.example.com/",
      token: "plain-secret-token",
      user: { id: "u1", username: "luoni", displayName: "洛尼" },
      routing: {
        spaceId: "space-1",
        activeNodeId: "node-1",
        localNodeId: "node-1",
        epoch: 2,
        nodes: [{
          nodeId: "node-1",
          serverUrl: "https://aether.example.com/",
          token: "node-secret-token",
          lastSeenAt: 123
        }]
      }
    });
    const raw = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(raw, /plain-secret-token/);
    assert.doesNotMatch(raw, /node-secret-token/);
    assert.deepEqual(store.load(), {
      serverUrl: "https://aether.example.com",
      token: "plain-secret-token",
      user: { id: "u1", username: "luoni", displayName: "洛尼" },
      routing: {
        spaceId: "space-1",
        activeNodeId: "node-1",
        localNodeId: "node-1",
        epoch: 2,
        nodes: [{
          nodeId: "node-1",
          serverUrl: "https://aether.example.com",
          token: "node-secret-token",
          lastSeenAt: 123
        }]
      }
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("desktop keeps computer Hub credentials as the authentication authority", () => {
  const selected = selectAuthenticationSession({
    serverUrl: "http://172.31.17.114:4319",
    token: "mobile-session",
    routing: {
      nodes: [
        { nodeId: "desktop", serverUrl: "http://127.0.0.1:4318", token: "desktop-session" },
        { nodeId: "mobile", serverUrl: "http://172.31.17.114:4319", token: "mobile-session" }
      ]
    }
  }, "http://127.0.0.1:4318");

  assert.deepEqual(selected, {
    serverUrl: "http://127.0.0.1:4318",
    token: "desktop-session"
  });
});

test("a stale direct mobile Hub login address falls back to the bundled computer Hub", () => {
  assert.deepEqual(
    selectAuthenticationSession({
      serverUrl: "http://172.31.17.114:4319",
      token: "",
      routing: null
    }, "http://127.0.0.1:4318"),
    { serverUrl: "http://127.0.0.1:4318", token: "" }
  );
});

test("login screen exposes server selection, registration and migration assurance", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "auth.html"), "utf8");
  assert.match(html, /id="serverUrl"/);
  assert.match(html, /id="loginTab"/);
  assert.match(html, /id="registerTab"/);
  assert.match(html, /现有数据会被完整保留/);
});
