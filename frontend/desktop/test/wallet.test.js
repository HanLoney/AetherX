const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "wallet.html"), "utf8");
const css = fs.readFileSync(path.join(root, "wallet.css"), "utf8");
const script = fs.readFileSync(path.join(root, "wallet.js"), "utf8");
const home = fs.readFileSync(path.join(root, "home.js"), "utf8");
const settings = fs.readFileSync(path.join(root, "module-settings.js"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const { registerWalletTools } = require(path.join(root, "wallet-tools.js"));

test("钱包页面提供多项存款概览和完整编辑入口", () => {
  for (const id of [
    "primaryTotal",
    "currencyTotals",
    "accountList",
    "accountForm",
    "nameInput",
    "amountInput",
    "currencyInput",
    "noteInput",
    "changeDetailInput",
    "transactionCount",
    "transactionList",
    "transactionTemplate",
    "ledgerTitle",
    "ledgerBalance",
    "editAccountBtn",
    "addTransactionBtn",
    "accountDialog",
    "transactionDialog",
    "transactionForm",
    "transactionAmountInput",
    "transactionDetailInput",
    "transactionDialogEyebrow",
    "transactionDialogTitle",
    "newAccountBtn",
    "deleteAccountBtn"
  ]) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(script, /getWalletSummary/);
  assert.match(script, /listWalletTransactions/);
  assert.match(script, /createWalletAccount/);
  assert.match(script, /updateWalletAccount/);
  assert.match(script, /adjustWalletAccount/);
  assert.match(script, /updateWalletTransaction/);
  assert.match(script, /deleteWalletAccount/);
  assert.match(script, /showModal\(\)/);
  assert.match(html, /data-kind="income"/);
  assert.match(html, /data-kind="expense"/);
  assert.match(html, /class="transaction-panel"/);
  assert.match(script, /"wallet_accounts", "wallet_transactions"/);
  assert.match(script, /来自聊天/);
  assert.match(script, /balanceBefore/);
  assert.match(script, /balanceAfter/);
  assert.match(css, /\.balance-hero/);
  assert.match(css, /\.account-row/);
  assert.match(css, /\.transaction-row/);
  assert.match(css, /\.transaction-edit/);
  assert.match(css, /\.transaction-kind/);
  assert.match(css, /\.account-dialog\[data-mode="edit"\] \.amount-fields/);
  assert.match(css, /body\.embedded/);
});

test("钱包作为独立模块进入桌面导航、功能插槽和安装包", () => {
  assert.match(settings, /id: "wallet"/);
  assert.match(home, /walletModuleBtn/);
  assert.match(home, /wallet\.html/);
  assert.ok(packageJson.build.files.includes("wallet.html"));
  assert.ok(packageJson.build.files.includes("wallet.css"));
  assert.ok(packageJson.build.files.includes("wallet.js"));
  const agentTools = packageJson.build.extraResources
    .find((item) => item.to === "agent-tools")?.filter || [];
  assert.ok(agentTools.includes("wallet-tools.js"));
});

test("聊天工具能查询并精确修改单笔流水，不会把流水误当账户资料", () => {
  const definitions = [];
  registerWalletTools({ register: (definition) => definitions.push(definition) });
  const byName = new Map(definitions.map((definition) => [definition.name, definition]));
  assert.ok(byName.has("wallet.transactions"));
  assert.ok(byName.has("wallet.transaction.update"));
  assert.deepEqual(
    Object.keys(byName.get("wallet.update").inputSchema.properties),
    ["id", "name", "note"]
  );
  assert.ok(byName.get("wallet.adjust").inputSchema.required.includes("detail"));
  assert.match(byName.get("wallet.transaction.update").description, /重算后续流水与账户余额/);
});
