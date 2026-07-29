const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
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

test("desktop reads and updates the Hub-owned tool authorization policy", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({
      data: { autoApproveWrites: options?.method === "PUT", updatedAt: 1 }
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const client = new XuanApiClient({ baseUrl: "http://127.0.0.1:4318" });
    await client.getAgentPermissions();
    await client.updateAgentPermissions({ autoApproveWrites: true });

    assert.equal(
      requests[0].url,
      "http://127.0.0.1:4318/api/v1/agent/permissions"
    );
    assert.equal(requests[0].options.method, "GET");
    assert.equal(requests[1].options.method, "PUT");
    assert.deepEqual(JSON.parse(requests[1].options.body), {
      autoApproveWrites: true
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test("desktop module center reads and records real module activity", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ data: { events: [], nextCursor: 4 } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const client = new XuanApiClient({ baseUrl: "http://127.0.0.1:4318" });
    await client.listModuleActivity({ after: 3, limit: 20 });
    await client.recordModuleActivity({
      callId: "call-1",
      sourceModuleId: "ai",
      targetModuleId: "memory",
      operation: "读取相关记忆",
      status: "running"
    });
    assert.equal(
      requests[0].url,
      "http://127.0.0.1:4318/api/v1/modules/activity?after=3&limit=20"
    );
    assert.equal(requests[1].url, "http://127.0.0.1:4318/api/v1/modules/activity");
    assert.equal(JSON.parse(requests[1].options.body).targetModuleId, "memory");
  } finally {
    global.fetch = originalFetch;
  }
});

test("desktop wallet client supports summary, multiple records and balance adjustment", async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  };
  try {
    const client = new XuanApiClient({ baseUrl: "http://127.0.0.1:4318" });
    await client.getWalletSummary();
    await client.listWalletTransactions("wallet/id", { limit: 30 });
    await client.createWalletAccount({ name: "工资卡", amount: "100" });
    await client.updateWalletAccount("wallet/id", { amount: "120" });
    await client.adjustWalletAccount("wallet/id", { change: "20" });
    await client.deleteWalletAccount("wallet/id");

    assert.deepEqual(requests.map((item) => [item.options.method, item.url]), [
      ["GET", "http://127.0.0.1:4318/api/v1/wallet"],
      ["GET", "http://127.0.0.1:4318/api/v1/wallet/accounts/wallet%2Fid/transactions?limit=30"],
      ["POST", "http://127.0.0.1:4318/api/v1/wallet/accounts"],
      ["PATCH", "http://127.0.0.1:4318/api/v1/wallet/accounts/wallet%2Fid"],
      ["POST", "http://127.0.0.1:4318/api/v1/wallet/accounts/wallet%2Fid/adjust"],
      ["DELETE", "http://127.0.0.1:4318/api/v1/wallet/accounts/wallet%2Fid"]
    ]);
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

test("desktop optional modules are hydrated from Hub and loaded through lifecycles", () => {
  const home = fs.readFileSync(path.join(__dirname, "..", "home.js"), "utf8");
  const html = fs.readFileSync(path.join(__dirname, "..", "home.html"), "utf8");
  const settings = fs.readFileSync(
    path.join(__dirname, "..", "module-settings.js"),
    "utf8"
  );
  for (const source of [
    "xuan-mood.js",
    "mood-heartbeat.js",
    "reminder-engine.js",
    "journal-writer.js",
    "dream-writer.js"
  ]) {
    assert.doesNotMatch(html, new RegExp(`<script src="${source}"`));
    assert.match(home, new RegExp(`loadModuleScript\\("${source.replace(".", "\\.")}\\"`));
  }
  assert.match(home, /reminderEngine\?\.stop\(\)/);
  assert.match(home, /journalWriter\?\.stop\(\)/);
  assert.match(home, /dreamWriter\?\.stop\(\)/);
  assert.match(settings, /client\?\.listModules/);
  assert.match(settings, /global\.desktop\?\.updateModule/);
});

test("心情模块在模块中心明确展示心率与对话感知", () => {
  const settings = fs.readFileSync(
    path.join(__dirname, "..", "module-settings.js"),
    "utf8"
  );
  const modules = fs.readFileSync(path.join(__dirname, "..", "modules.js"), "utf8");
  assert.match(settings, /id: "xuan-mood"[\s\S]*心率[\s\S]*带入对话/);
  assert.match(modules, /"xuan-mood": "AX-VTL-01"/);
  assert.match(modules, /生命体征不可用|心跳已暂停/);
});

test("desktop migrates legacy disabled module switches into Hub", async () => {
  const values = new Map([
    ["xuan-module-settings-v1", JSON.stringify({ todo: false })]
  ]);
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const window = {
    localStorage,
    dispatchEvent() {}
  };
  const CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "module-settings.js"), "utf8"),
    { window, localStorage, CustomEvent }
  );
  const updates = [];
  const initial = [
    { id: "ai", core: true, enabled: true, updatedAt: null },
    { id: "todo", core: false, enabled: true, updatedAt: null }
  ];
  await window.XuanModules.hydrate({
    listModules: async () => initial,
    updateModule: async (id, enabled) => {
      updates.push({ id, enabled });
      return initial.map((module) =>
        module.id === id ? { ...module, enabled, updatedAt: 1 } : module
      );
    }
  });

  assert.deepEqual(updates, [{ id: "todo", enabled: false }]);
  assert.equal(window.XuanModules.isEnabled("todo"), false);
});

test("desktop migrates and persists the legacy automatic authorization switch in Hub", async () => {
  const values = new Map([
    ["xuan-module-settings-v1", JSON.stringify({ autoApproveTools: true })]
  ]);
  const localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value)
  };
  const updates = [];
  const client = {
    listModules: async () => [
      { id: "ai", core: true, enabled: true, updatedAt: null }
    ],
    getAgentPermissions: async () => ({
      autoApproveWrites: false,
      updatedAt: null
    }),
    updateAgentPermissions: async ({ autoApproveWrites }) => {
      updates.push(autoApproveWrites);
      return { autoApproveWrites, updatedAt: updates.length };
    }
  };
  const window = {
    localStorage,
    desktop: client,
    dispatchEvent() {}
  };
  const CustomEvent = class CustomEvent {
    constructor(type, options = {}) {
      this.type = type;
      this.detail = options.detail;
    }
  };
  vm.runInNewContext(
    fs.readFileSync(path.join(__dirname, "..", "module-settings.js"), "utf8"),
    { window, localStorage, CustomEvent }
  );

  await window.XuanModules.hydrate(client);
  assert.equal(window.XuanModules.isAutoApproveEnabled(), true);
  await window.XuanModules.setAutoApprove(false);
  assert.equal(window.XuanModules.isAutoApproveEnabled(), false);
  assert.deepEqual(updates, [true, false]);
});
