const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openDatabase } = require("../src/infrastructure/database");
const {
  ModuleSettingsRepository
} = require("../src/modules/module-settings/module-settings-repository");
const { ModuleManager } = require("../src/modules/module-settings/module-manager");
const { moduleForTool } = require("../src/modules/module-settings/module-manifest");
const { createAgentToolRuntime } = require("../src/modules/agent/agent-tool-runtime");

test("模块状态按用户持久化，并在关闭依赖时级联停用", (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-modules-"));
  const database = openDatabase(dataDir);
  context.after(() => {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  database.prepare(
    `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("user-1", "module-user", "Module User", "hash", 1, 1);
  const manager = new ModuleManager(new ModuleSettingsRepository(database));

  assert.equal(manager.isEnabled("user-1", "todo"), true);
  assert.equal(manager.isEnabled("user-1", "proactive-reminders"), true);
  manager.setEnabled("user-1", "todo", false);
  assert.equal(manager.isEnabled("user-1", "todo"), false);
  assert.equal(manager.isEnabled("user-1", "proactive-reminders"), false);
  assert.throws(
    () => manager.setEnabled("user-1", "proactive-reminders", true),
    (error) => error.code === "MODULE_DEPENDENCY_DISABLED"
  );
  assert.throws(
    () => manager.setEnabled("user-1", "ai", false),
    (error) => error.code === "CORE_MODULE_REQUIRED"
  );
});

test("Agent 工具列表只包含已启用模块，并保留核心画像工具", async () => {
  let todoEnabled = false;
  let walletEnabled = false;
  const moduleManager = {
    snapshot: () => [
      { id: "ai", enabled: true },
      { id: "memory", enabled: true },
      { id: "todo", enabled: todoEnabled },
      { id: "wallet", enabled: walletEnabled },
      { id: "image-generation", enabled: false },
      { id: "autonomous-journal", enabled: false },
      { id: "anniversary-album", enabled: false },
      { id: "dreams", enabled: false }
    ],
    isEnabled: (_userId, moduleId) =>
      moduleId === "todo"
        ? todoEnabled
        : moduleId === "wallet"
          ? walletEnabled
          : moduleId === "memory" || moduleId === "ai",
    moduleForTool
  };
  const runtime = createAgentToolRuntime({
    moduleManager,
    aiConfigRepository: {
      getImagePublic: () => {
        throw new Error("关闭图像模块后不应读取图像配置");
      }
    },
    assistantMemoryService: { getProfile: () => ({}) },
    walletService: {
      summary: () => ({ accountCount: 0, totals: {}, accounts: [] }),
      listTransactions: () => ([{
        id: "transaction-1",
        accountId: "wallet-1",
        change: -10,
        changeMinor: -1000,
        detail: "原支出"
      }]),
      updateTransaction: (_userId, accountId, transactionId, input) => ({
        account: { id: accountId, name: "旅行基金", amount: 80, currency: "CNY" },
        transaction: { id: transactionId, detail: input.detail, change: input.change }
      }),
      create: (_userId, input) => ({
        id: "wallet-1",
        name: input.name,
        amount: Number(input.amount),
        currency: input.currency || "CNY",
        note: "",
        balanceMinor: Number(input.amount) * 100
      })
    }
  });
  const tools = await runtime.forUser("user-1", (registry) =>
    registry.modelTools().map((tool) => tool.function.name)
  );

  assert.ok(tools.includes("memory_list"));
  assert.ok(tools.includes("profile_get"));
  assert.ok(tools.includes("assistant_profile_get"));
  assert.ok(!tools.some((name) => name.startsWith("todo_")));
  assert.ok(!tools.some((name) => name.startsWith("wallet_")));
  assert.ok(!tools.some((name) => name.startsWith("journal_")));
  assert.ok(!tools.some((name) => name.startsWith("album_")));
  assert.ok(!tools.some((name) => name.startsWith("dream_")));
  assert.ok(!tools.includes("image_generate"));

  await runtime.forUser("user-1", async (registry) => {
    todoEnabled = true;
    assert.ok(registry.modelTools().some((tool) => tool.function.name === "todo_list"));
    todoEnabled = false;
    assert.ok(!registry.modelTools().some((tool) => tool.function.name === "todo_list"));
    const result = await registry.call("todo_list", {});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "MODULE_DISABLED");

    walletEnabled = true;
    assert.ok(registry.modelTools().some((tool) => tool.function.name === "wallet_list"));
    assert.equal(moduleForTool("wallet.adjust"), "wallet");
    const created = await registry.call("wallet_create", {
      name: "旅行基金",
      amount: 100
    });
    assert.equal(created.ok, true);
    assert.equal(created.data.name, "旅行基金");
    const history = await registry.call("wallet_transactions", { id: "wallet-1" });
    assert.equal(history.ok, true);
    assert.equal(history.data[0].id, "transaction-1");
    const corrected = await registry.call("wallet_transaction_update", {
      accountId: "wallet-1",
      transactionId: "transaction-1",
      change: -20,
      detail: "更正后的支出"
    });
    assert.equal(corrected.ok, true);
    assert.equal(corrected.data.transaction.detail, "更正后的支出");
    walletEnabled = false;
    assert.ok(!registry.modelTools().some((tool) => tool.function.name === "wallet_list"));
  });
});
