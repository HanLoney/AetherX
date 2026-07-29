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
  assert.throws(
    () => service.adjust("user-1", card.id, { change: "-1300.01" }),
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
