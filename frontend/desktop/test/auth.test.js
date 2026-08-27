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
const {
  CLOUD_PRODUCT,
  cloudUserDataPath,
  isCloudDesktopEdition,
  resolveDesktopServerUrl
} = require("../edition-config");

test("desktop editions use independent product identity, storage and packaged Cloud API", () => {
  assert.equal(CLOUD_PRODUCT.appId, "com.xuanxiaotech.aetherx.online.desktop");
  assert.equal(CLOUD_PRODUCT.productName, "AetherX Online");
  assert.equal(
    cloudUserDataPath(path.join("C:", "Users", "test", "AppData", "Roaming")),
    path.join("C:", "Users", "test", "AppData", "Roaming", "AetherX Online")
  );
  assert.equal(isCloudDesktopEdition({ packageMetadata: { aetherxEdition: "cloud" } }), true);
  assert.equal(resolveDesktopServerUrl({
    cloudEdition: true,
    packaged: true,
    env: { AETHERX_SERVER_URL: "http://attacker.invalid" },
    localServerUrl: "http://127.0.0.1:4318"
  }), "https://api.aetherx.tech");
  assert.equal(resolveDesktopServerUrl({
    cloudEdition: true,
    packaged: false,
    env: { AETHERX_CLOUD_SERVER_URL: "https://staging.example" },
    localServerUrl: "http://127.0.0.1:4318"
  }), "https://staging.example");
});

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

test("API client refreshes an expired cloud session and retries the request once", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  let changedSession = null;
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith("/api/v1/auth/refresh")) {
      assert.deepEqual(JSON.parse(options.body), { refreshToken: "old-refresh" });
      return new Response(JSON.stringify({ data: {
        token: "new-access",
        refreshToken: "new-refresh",
        expiresAt: 123,
        refreshExpiresAt: 456,
        user: { id: "u1", email: "loney@example.com", displayName: "洛尼" }
      } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (calls.length === 1) {
      return new Response(JSON.stringify({
        error: { code: "SESSION_EXPIRED", message: "登录状态已过期。" }
      }), { status: 401, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: {
      user: { id: "u1", email: "loney@example.com", displayName: "洛尼" }
    } }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  try {
    const client = new XuanApiClient({
      baseUrl: "https://api.aetherx.tech",
      token: "old-access",
      refreshToken: "old-refresh",
      onSessionChanged: (session) => { changedSession = session; }
    });
    const session = await client.getSession();
    assert.equal(session.user.email, "loney@example.com");
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.headers.Authorization, "Bearer old-access");
    assert.equal(calls[1].options.headers.Authorization, undefined);
    assert.equal(calls[2].options.headers.Authorization, "Bearer new-access");
    assert.equal(client.token, "new-access");
    assert.equal(client.refreshToken, "new-refresh");
    assert.equal(changedSession.refreshToken, "new-refresh");
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

test("API client retries transient mobile Hub read failures without retrying writes", async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method });
    if (calls.length < 3) {
      return new Response(JSON.stringify({
        error: {
          code: "LOCAL_HUB_BUSY",
          message: "手机 Hub 网络服务暂时不可用。"
        }
      }), { status: 503, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ data: { displayName: "洛尼" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const client = new XuanApiClient({
      baseUrl: "http://172.31.17.146:4319",
      token: "mobile-token"
    });
    const profile = await client.getProfile();
    assert.equal(profile.displayName, "洛尼");
    assert.equal(calls.length, 3);
    assert.deepEqual(calls.map((call) => call.method), ["GET", "GET", "GET"]);
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
      refreshToken: "plain-refresh-token",
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
    assert.doesNotMatch(raw, /plain-refresh-token/);
    assert.doesNotMatch(raw, /node-secret-token/);
    assert.deepEqual(store.load(), {
      serverUrl: "https://aether.example.com",
      token: "plain-secret-token",
      refreshToken: "plain-refresh-token",
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

test("auth store preserves a cloud email identity without inventing a username", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "aether-cloud-auth-store-"));
  const filePath = path.join(directory, "auth.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`encrypted:${value}`),
    decryptString: (value) => value.toString().replace(/^encrypted:/, "")
  };
  try {
    const store = new AuthStore(filePath, safeStorage);
    store.save({
      serverUrl: "https://online.aetherx.example",
      token: "cloud-token",
      refreshToken: "cloud-refresh-token",
      user: {
        id: "cloud-user",
        email: "loney@example.com",
        emailVerified: true,
        displayName: "洛尼"
      }
    });
    assert.deepEqual(store.load().user, {
      id: "cloud-user",
      email: "loney@example.com",
      emailVerified: true,
      displayName: "洛尼"
    });
    assert.equal(store.load().refreshToken, "cloud-refresh-token");
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
  assert.match(html, /id="hubRoutePanel"/);
  assert.match(html, /id="computerHubNode"/);
  assert.match(html, /id="mobileHubNode"/);
  assert.match(html, /id="scanHubBtn"/);
  assert.match(html, /id="qrLoginPanel"/);
  assert.match(html, /id="qrLoginImage"/);
  assert.match(html, /手机 Hub 快速登录/);
  assert.match(html, /class="login-options"/);
  assert.match(html, /class="credential-login"/);
  assert.doesNotMatch(html, /auth-story|PRIVATE DIGITAL SPACE|回到只属于/);
  assert.match(html, /class="advanced-server"/);
  assert.match(html, /现有数据会被完整保留/);
  assert.match(html, /id="emailVerificationPanel"/);
  assert.match(html, /id="emailVerificationToken"/);
  assert.match(html, /id="verificationLoginBtn"/);
  assert.match(html, /已有账号：无需再次验证/);
  assert.match(html, /id="forgotPasswordBtn"/);
  assert.match(html, /id="passwordResetPanel"/);
});

test("desktop cloud edition skips the bundled Hub and supports email authentication", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  const auth = fs.readFileSync(path.join(__dirname, "..", "auth.js"), "utf8");
  const home = fs.readFileSync(path.join(__dirname, "..", "home.js"), "utf8");
  const preload = fs.readFileSync(path.join(__dirname, "..", "preload.js"), "utf8");
  const editionConfig = fs.readFileSync(path.join(__dirname, "..", "edition-config.js"), "utf8");
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const cloudBuilder = fs.readFileSync(path.join(__dirname, "..", "electron-builder.cloud.cjs"), "utf8");
  assert.match(editionConfig, /AETHERX_DESKTOP_EDITION/);
  assert.match(editionConfig, /argv\.includes\("--cloud"\)/);
  assert.equal(packageJson.scripts["start:cloud"], "electron . --cloud");
  assert.match(packageJson.scripts["dist:cloud"], /dist:cloud:installer/);
  assert.match(cloudBuilder, /CLOUD_PRODUCT\.appId/);
  assert.match(cloudBuilder, /aetherxEdition: "cloud"/);
  assert.match(cloudBuilder, /dist-cloud/);
  assert.match(cloudBuilder, /extraResources: \[\]/);
  assert.match(cloudBuilder, /_localInstallerInclude/);
  assert.match(main, /app\.setPath\("userData"/);
  assert.match(main, /app\.setAppUserModelId\(CLOUD_PRODUCT\.appId\)/);
  assert.match(main, /if \(!isCloudEdition\) \{/);
  assert.match(main, /authenticationIdentityMode === "email"/);
  assert.match(auth, /loginIdentifier === "email"/);
  assert.match(auth, /verifyEmail/);
  assert.match(auth, /await window\.desktop\.login\(input\)/);
  assert.match(auth, /returnToEmailLogin/);
  assert.match(auth, /requestPasswordReset/);
  assert.match(auth, /completePasswordReset/);
  assert.match(preload, /auth:verify-email/);
  assert.match(preload, /auth:password:forgot/);
  assert.match(preload, /auth:password:reset/);
  assert.match(main, /authenticationRefreshToken/);
  assert.match(fs.readFileSync(path.join(__dirname, "..", "api-client.js"), "utf8"), /\/api\/v1\/auth\/refresh/);
  assert.doesNotMatch(preload, /auth:sessions/);
  assert.doesNotMatch(home, /cloudSessions|authSessions/);
  assert.match(home, /state\.auth\?\.cloudEdition/);
  assert.match(home, /elements\.hubLabel\.textContent = "云端服务"/);
  assert.match(home, /deviceManagerBtn\.classList\.toggle\("hidden"/);
});

test("desktop packages LAN discovery and recovers the active mobile Hub before handoff", () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const main = fs.readFileSync(path.join(__dirname, "..", "main.js"), "utf8");
  assert.ok(packageJson.build.files.includes("mobile-hub-lan-discovery.js"));
  assert.match(main, /mobileHubLanDiscovery\.discoverCandidates\(\)/);
  assert.match(main, /verifyMobileHubEndpoint\(fetch, mobile\.address/);
  assert.match(main, /api\.discoverMobileHubEndpoint\(status\.activeNodeId, endpoint\)/);
  assert.match(main, /await ensureActiveHubWithDiscovery\(\)/);
  assert.match(main, /auth:hub-discovery/);
  assert.match(main, /auth:qr-login:create/);
  assert.match(main, /auth:qr-login:poll/);
  assert.match(main, /\/api\/v1\/auth\/desktop-login\/challenges/);
  assert.match(main, /aetherx:\/\/desktop-login/);
  assert.match(main, /auth:hub-progress/);
  assert.match(main, /stage: "searching"/);
  assert.match(main, /stage: "verifying"/);
  assert.match(main, /stage: "connected"/);
  assert.match(main, /pendingTarget: "mobile"/);
  assert.match(main, /手机 Hub 暂未在线，稍后会自动重连/);
});
