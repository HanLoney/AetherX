const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openDatabase } = require("../src/infrastructure/database");
const { WalletRepository } = require("../src/modules/wallet/wallet-repository");
const { WalletService, parseAmountMinor } = require("../src/modules/wallet/wallet-service");

test("钱包按用户保存多项存款，并使用整数分精确汇总", (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-wallet-"));
  const database = openDatabase(dataDir);
  context.after(() => {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  for (const [id, username] of [["user-1", "wallet-one"], ["user-2", "wallet-two"]]) {
    database.prepare(
      `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, username, username, "hash", 1, 1);
  }
  const service = new WalletService(new WalletRepository(database));
  const card = service.create("user-1", {
    name: "工资卡",
    amount: "1234.56",
    currency: "cny",
    note: "日常储蓄",
    detail: "期初工资结余"
  }, { source: "chat" });
  service.create("user-1", { name: "旅行基金", amount: "100.44" });
  service.create("user-1", { name: "美元存款", amount: "12.30", currency: "USD" });
  service.create("user-2", { name: "其他人的卡", amount: "99999" });

  const summary = service.summary("user-1");
  assert.equal(summary.accountCount, 3);
  assert.deepEqual(summary.totals.CNY, { balanceMinor: 133500, amount: 1335 });
  assert.deepEqual(summary.totals.USD, { balanceMinor: 1230, amount: 12.3 });
  assert.equal(summary.accounts.some((item) => item.name === "其他人的卡"), false);

  const adjusted = service.adjust(
    "user-1",
    card.id,
    { change: "65.44", detail: "奖金存入" },
    { source: "chat" }
  );
  assert.equal(adjusted.amount, 1300);
  const updated = service.update("user-1", card.id, {
    name: "主卡",
    note: "主要存款",
    detail: "更新账户用途"
  });
  assert.equal(updated.name, "主卡");
  assert.equal(updated.amount, 1300);
  const transactions = service.listTransactions("user-1", card.id);
  assert.equal(transactions.length, 3);
  assert.deepEqual(
    transactions.map((transaction) => transaction.eventType),
    ["edit", "deposit", "create"]
  );
  assert.equal(transactions[0].detail, "更新账户用途");
  assert.equal(transactions[0].changeMinor, 0);
  assert.equal(transactions[0].source, "manual");
  assert.equal(transactions[1].detail, "奖金存入");
  assert.equal(transactions[1].balanceBeforeMinor, 123456);
  assert.equal(transactions[1].balanceAfterMinor, 130000);
  assert.equal(transactions[1].source, "chat");
  assert.equal(transactions[2].detail, "期初工资结余");
  assert.equal(transactions[2].source, "chat");
  const corrected = service.updateTransaction("user-1", card.id, transactions[1].id, {
    change: "-34.56",
    detail: "更正为旧车支出"
  });
  assert.equal(corrected.account.amount, 1200);
  assert.equal(corrected.transaction.eventType, "withdrawal");
  assert.equal(corrected.transaction.changeMinor, -3456);
  assert.equal(corrected.transaction.balanceBeforeMinor, 123456);
  assert.equal(corrected.transaction.balanceAfterMinor, 120000);
  const recalculated = service.listTransactions("user-1", card.id);
  assert.equal(recalculated[0].balanceBeforeMinor, 120000);
  assert.equal(recalculated[0].balanceAfterMinor, 120000);
  assert.throws(
    () => service.updateTransaction("user-1", card.id, transactions[2].id, { change: "10" }),
    (error) => error.code === "WALLET_HISTORY_BALANCE_NEGATIVE"
  );
  assert.equal(service.get("user-1", card.id).amount, 1200);
  assert.throws(
    () => service.adjust("user-1", card.id, { change: "-1200.01" }),
    (error) => error.code === "WALLET_BALANCE_NEGATIVE"
  );

  service.delete("user-1", card.id);
  assert.equal(service.list("user-1").length, 2);
});

test("钱包金额拒绝浮点精度、无效格式和超范围数据", () => {
  assert.equal(parseAmountMinor("0.01", "金额"), 1);
  assert.equal(parseAmountMinor("1,234.50", "金额"), 123450);
  assert.equal(parseAmountMinor("-0.25", "金额", { signed: true }), -25);
  assert.throws(() => parseAmountMinor("1.234", "金额"), /最多两位小数/);
  assert.throws(() => parseAmountMinor("1e5", "金额"), /最多两位小数/);
  assert.throws(() => parseAmountMinor("-1", "金额"), /最多两位小数/);
});

test("旧账户会补齐期初余额，并能安全修改历史流水", (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-wallet-legacy-"));
  let database = openDatabase(dataDir);
  context.after(() => {
    database?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  database.prepare(
    `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run("legacy-user", "legacy-wallet", "旧钱包", "hash", 1, 1);
  database.prepare(
    `INSERT INTO wallet_accounts(
       id, user_id, name, balance_minor, currency, note, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run("legacy-account", "legacy-user", "小金库", 134078, "CNY", "", 100, 400);
  const insertTransaction = database.prepare(
    `INSERT INTO wallet_transactions(
       id, user_id, account_id, event_type, change_minor,
       balance_before_minor, balance_after_minor, previous_currency,
       currency, detail, source, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  insertTransaction.run(
    "legacy-refund", "legacy-user", "legacy-account", "deposit", 900,
    64400, 65300, "CNY", "CNY", "奶茶退款", "chat", 200
  );
  insertTransaction.run(
    "legacy-delivery", "legacy-user", "legacy-account", "withdrawal", -1162,
    65300, 64138, "CNY", "CNY", "寄快递", "chat", 300
  );
  insertTransaction.run(
    "legacy-sale", "legacy-user", "legacy-account", "deposit", 69940,
    64138, 134078, "CNY", "CNY", "闲鱼到账", "chat", 400
  );
  database.prepare(
    "DELETE FROM schema_migrations WHERE version = 29"
  ).run();
  database.close();
  database = openDatabase(dataDir);

  const service = new WalletService(new WalletRepository(database));
  const chronological = database.prepare(
    `SELECT event_type, change_minor, balance_before_minor, balance_after_minor
     FROM wallet_transactions
     WHERE account_id = ?
     ORDER BY created_at ASC, rowid ASC`
  ).all("legacy-account");
  assert.deepEqual({ ...chronological[0] }, {
    event_type: "create",
    change_minor: 64400,
    balance_before_minor: 0,
    balance_after_minor: 64400
  });
  const corrected = service.updateTransaction(
    "legacy-user",
    "legacy-account",
    "legacy-sale",
    { change: "699.42", detail: "卖了旧小电动车" }
  );
  assert.equal(corrected.account.balanceMinor, 134080);
  assert.equal(corrected.account.amount, 1340.8);
  assert.equal(corrected.transaction.changeMinor, 69942);
  assert.equal(corrected.transaction.balanceBeforeMinor, 64138);
  assert.equal(corrected.transaction.balanceAfterMinor, 134080);
});
