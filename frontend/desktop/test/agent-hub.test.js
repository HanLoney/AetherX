const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { XuanApiClient } = require("../api-client");

test("desktop chat delegates messages and approvals to Agent Hub", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ data: { status: "completed" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const client = new XuanApiClient({ baseUrl: "http://127.0.0.1:4318" });
    await client.agentChat({ content: "你好" });
    await client.approveAgentRun("run/id", true);
    assert.equal(requests[0].url, "http://127.0.0.1:4318/api/v1/agent/chat");
    assert.equal(
      requests[1].url,
      "http://127.0.0.1:4318/api/v1/agent/runs/run%2Fid/approve"
    );
    assert.deepEqual(JSON.parse(requests[1].options.body), { approved: true });
  } finally {
    global.fetch = originalFetch;
  }
});

test("desktop renderer contains no second Agent loop or renderer tool registry", () => {
  const home = fs.readFileSync(path.join(__dirname, "..", "home.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "home.html"), "utf8");
  assert.match(home, /window\.desktop\.agentChat\(/);
  assert.match(home, /window\.desktop\.approveAgentRun\(/);
  assert.doesNotMatch(home, /runAgentLoop|sendMessageLegacy|new window\.XuanToolRegistry/);
  assert.doesNotMatch(home, /figcaption\.textContent\s*=\s*message\.image\.description/);
  assert.doesNotMatch(html, /<script src="(?:tool-registry|(?:todo|memory|journal|album|dream|image)-tools)\.js"><\/script>/);
});
