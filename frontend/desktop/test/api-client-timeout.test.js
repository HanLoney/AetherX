const assert = require("node:assert/strict");
const test = require("node:test");
const { requestTimeoutForPath } = require("../api-client");

test("mobile Hub switch waits for the complete peer state machine", () => {
  assert.equal(
    requestTimeoutForPath("/api/v1/cluster/mobile-hubs/android-node/switch"),
    300_000
  );
});

test("ordinary API requests keep the bounded default timeout", () => {
  assert.equal(requestTimeoutForPath("/api/v1/todos"), 65_000);
  assert.equal(requestTimeoutForPath("/api/v1/ai/image-generations"), 245_000);
  assert.equal(requestTimeoutForPath("/api/v1/agent/chat"), 300_000);
});

test("profile surfaces fail fast enough to fall back to their local snapshot", () => {
  assert.equal(requestTimeoutForPath("/api/v1/profile"), 15_000);
  assert.equal(requestTimeoutForPath("/api/v1/assistant/profile"), 15_000);
  assert.equal(requestTimeoutForPath("/api/v1/assistant/journals?limit=50"), 15_000);
  assert.equal(requestTimeoutForPath("/api/v1/assistant/gallery/summary?limit=3"), 15_000);
});
