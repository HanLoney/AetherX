const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { XuanApiClient } = require("../api-client");
const { AuthStore } = require("../auth-store");

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
      user: { id: "u1", username: "luoni", displayName: "洛尼" }
    });
    const raw = fs.readFileSync(filePath, "utf8");
    assert.doesNotMatch(raw, /plain-secret-token/);
    assert.deepEqual(store.load(), {
      serverUrl: "https://aether.example.com",
      token: "plain-secret-token",
      user: { id: "u1", username: "luoni", displayName: "洛尼" }
    });
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("login screen exposes server selection, registration and migration assurance", () => {
  const html = fs.readFileSync(path.join(__dirname, "..", "auth.html"), "utf8");
  assert.match(html, /id="serverUrl"/);
  assert.match(html, /id="loginTab"/);
  assert.match(html, /id="registerTab"/);
  assert.match(html, /现有数据会被完整保留/);
});
