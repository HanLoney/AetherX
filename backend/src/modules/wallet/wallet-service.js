const { randomUUID } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");

const MAX_BALANCE_MINOR = 100_000_000_000_000;

class WalletService {
  constructor(repository) {
    this.repository = repository;
  }

  list(userId) {
    return this.repository.list(userId);
  }

  summary(userId) {
    const accounts = this.list(userId);
    const totals = {};
    for (const account of accounts) {
      totals[account.currency] = (totals[account.currency] || 0) + account.balanceMinor;
    }
    return {
      accountCount: accounts.length,
      totals: Object.fromEntries(
        Object.entries(totals).map(([currency, balanceMinor]) => [
          currency,
          { balanceMinor, amount: balanceMinor / 100 }
        ])
      ),
      accounts
    };
  }

  get(userId, id) {
    const account = this.repository.findById(userId, id);
    if (!account) {
      throw new HttpError(404, "WALLET_ACCOUNT_NOT_FOUND", "没有找到这项存款。");
    }
    return account;
  }

  listTransactions(userId, id, filters = {}) {
    this.get(userId, id);
    const limit = Math.max(1, Math.min(500, Number(filters.limit) || 100));
    return this.repository.listTransactions(userId, id, limit);
  }

  getTransaction(userId, accountId, transactionId) {
    this.get(userId, accountId);
    const transaction = this.repository.findTransaction(userId, accountId, transactionId);
    if (!transaction) {
      throw new HttpError(404, "WALLET_TRANSACTION_NOT_FOUND", "没有找到这笔钱包流水。");
    }
    return transaction;
  }

  updateTransaction(userId, accountId, transactionId, input = {}) {
    const account = this.get(userId, accountId);
    const current = this.getTransaction(userId, accountId, transactionId);
    const detail = input.detail === undefined ? current.detail : validateDetail(input.detail);
    let changeMinor = current.changeMinor;
    if (input.change !== undefined) {
      changeMinor = parseAmountMinor(input.change, "流水金额", { signed: true });
      if (current.eventType === "create" && changeMinor < 0) {
        throw new HttpError(400, "WALLET_INITIAL_BALANCE_NEGATIVE", "初始余额不能改成负数。");
      }
      if (current.eventType !== "create" && !changeMinor) {
        throw new HttpError(400, "WALLET_CHANGE_REQUIRED", "收入或支出金额不能为零。");
      }
    }
    if (detail === current.detail && changeMinor === current.changeMinor) {
      return { account, transaction: current };
    }
    const eventType = input.change === undefined
      ? current.eventType
      : current.eventType === "create"
      ? "create"
      : changeMinor == null || changeMinor === 0
        ? "edit"
        : changeMinor > 0
          ? "deposit"
          : "withdrawal";
    return this.repository.transaction(() => {
      this.ensureOpeningTransaction(userId, account);
      this.repository.updateTransaction(userId, accountId, transactionId, {
        eventType,
        changeMinor,
        detail
      });
      const updatedAccount = this.recalculateAccount(userId, accountId);
      return {
        account: updatedAccount,
        transaction: this.repository.findTransaction(userId, accountId, transactionId)
      };
    });
  }

  create(userId, input = {}, options = {}) {
    const now = Date.now();
    const draft = {
      id: randomUUID(),
      name: validateName(input.name),
      balanceMinor: parseAmountMinor(input.amount ?? 0, "存款金额"),
      currency: validateCurrency(input.currency),
      note: validateNote(input.note),
      createdAt: now,
      updatedAt: now
    };
    return this.repository.transaction(() => {
      const account = this.repository.create(userId, draft);
      this.recordTransaction(userId, account, {
        eventType: "create",
        changeMinor: account.balanceMinor,
        balanceBeforeMinor: 0,
        previousCurrency: account.currency,
        detail: validateDetail(input.detail) || "记录初始余额",
        source: options.source,
        createdAt: now
      });
      return account;
    });
  }

  update(userId, id, input = {}, options = {}) {
    const current = this.get(userId, id);
    const changes = {
      name: input.name === undefined ? current.name : validateName(input.name),
      balanceMinor: input.amount === undefined
        ? current.balanceMinor
        : parseAmountMinor(input.amount, "存款金额"),
      currency: input.currency === undefined
        ? current.currency
        : validateCurrency(input.currency),
      note: input.note === undefined ? current.note : validateNote(input.note)
    };
    const changed = ["name", "balanceMinor", "currency", "note"]
      .some((key) => changes[key] !== current[key]);
    if (!changed) return current;
    return this.repository.transaction(() => {
      const account = this.repository.update(userId, id, changes);
      const balanceChanged = account.balanceMinor !== current.balanceMinor;
      const currencyChanged = account.currency !== current.currency;
      this.recordTransaction(userId, account, {
        eventType: balanceChanged || currencyChanged ? "set" : "edit",
        changeMinor: currencyChanged
          ? null
          : account.balanceMinor - current.balanceMinor,
        balanceBeforeMinor: current.balanceMinor,
        previousCurrency: current.currency,
        detail: validateDetail(input.detail) || (
          balanceChanged || currencyChanged ? "更新当前余额" : "更新存款资料"
        ),
        source: options.source
      });
      return account;
    });
  }

  adjust(userId, id, input = {}, options = {}) {
    const current = this.get(userId, id);
    const changeMinor = parseAmountMinor(input.change, "调整金额", { signed: true });
    if (!changeMinor) {
      throw new HttpError(400, "WALLET_CHANGE_REQUIRED", "调整金额不能为零。");
    }
    const balanceMinor = current.balanceMinor + changeMinor;
    if (balanceMinor < 0) {
      throw new HttpError(400, "WALLET_BALANCE_NEGATIVE", "调整后余额不能小于零。");
    }
    if (balanceMinor > MAX_BALANCE_MINOR) {
      throw new HttpError(400, "WALLET_AMOUNT_TOO_LARGE", "存款金额超出可记录范围。");
    }
    return this.repository.transaction(() => {
      const account = this.repository.update(userId, id, { balanceMinor });
      this.recordTransaction(userId, account, {
        eventType: changeMinor > 0 ? "deposit" : "withdrawal",
        changeMinor,
        balanceBeforeMinor: current.balanceMinor,
        previousCurrency: current.currency,
        detail: validateDetail(input.detail) || (changeMinor > 0 ? "增加存款" : "减少存款"),
        source: options.source
      });
      return account;
    });
  }

  delete(userId, id) {
    if (!this.repository.delete(userId, id)) {
      throw new HttpError(404, "WALLET_ACCOUNT_NOT_FOUND", "没有找到这项存款。");
    }
  }

  recordTransaction(userId, account, input) {
    this.repository.recordTransaction(userId, {
      id: randomUUID(),
      accountId: account.id,
      eventType: input.eventType,
      changeMinor: input.changeMinor,
      balanceBeforeMinor: input.balanceBeforeMinor,
      balanceAfterMinor: account.balanceMinor,
      previousCurrency: input.previousCurrency,
      currency: account.currency,
      detail: input.detail,
      source: normalizeSource(input.source),
      createdAt: input.createdAt || Date.now()
    });
  }

  recalculateAccount(userId, accountId) {
    const transactions = this.repository.listTransactionsChronological(userId, accountId);
    let balanceMinor = 0;
    for (const transaction of transactions) {
      const before = balanceMinor;
      if (transaction.changeMinor != null) balanceMinor += transaction.changeMinor;
      if (balanceMinor < 0) {
        throw new HttpError(
          400,
          "WALLET_HISTORY_BALANCE_NEGATIVE",
          `修改“${transaction.detail}”后，后续余额会变成负数。`
        );
      }
      if (balanceMinor > MAX_BALANCE_MINOR) {
        throw new HttpError(400, "WALLET_AMOUNT_TOO_LARGE", "修改后的账户余额超出可记录范围。");
      }
      this.repository.updateTransactionBalances(
        userId,
        accountId,
        transaction.id,
        before,
        balanceMinor
      );
    }
    return this.repository.update(userId, accountId, { balanceMinor });
  }

  ensureOpeningTransaction(userId, account) {
    const transactions = this.repository.listTransactionsChronological(userId, account.id);
    if (transactions.some((transaction) => transaction.eventType === "create")) return;
    const first = transactions[0] || null;
    const openingBalanceMinor = first?.balanceBeforeMinor ?? account.balanceMinor;
    const currency = first?.previousCurrency || account.currency;
    this.repository.recordTransaction(userId, {
      id: randomUUID(),
      accountId: account.id,
      eventType: "create",
      changeMinor: openingBalanceMinor,
      balanceBeforeMinor: 0,
      balanceAfterMinor: openingBalanceMinor,
      previousCurrency: currency,
      currency,
      detail: "期初余额（历史数据补全）",
      source: "manual",
      createdAt: Math.min(account.createdAt, first ? first.createdAt - 1 : account.createdAt)
    });
  }
}

function validateName(value) {
  const name = String(value || "").trim();
  if (!name) {
    throw new HttpError(400, "WALLET_NAME_REQUIRED", "存款名称不能为空。");
  }
  if (name.length > 60) {
    throw new HttpError(400, "WALLET_NAME_TOO_LONG", "存款名称不能超过 60 个字符。");
  }
  return name;
}

function validateCurrency(value) {
  const currency = String(value || "CNY").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new HttpError(400, "WALLET_CURRENCY_INVALID", "币种必须使用三个字母的代码。");
  }
  return currency;
}

function validateNote(value) {
  const note = String(value || "").trim();
  if (note.length > 240) {
    throw new HttpError(400, "WALLET_NOTE_TOO_LONG", "备注不能超过 240 个字符。");
  }
  return note;
}

function validateDetail(value) {
  const detail = String(value || "").trim();
  if (detail.length > 160) {
    throw new HttpError(400, "WALLET_DETAIL_TOO_LONG", "变动说明不能超过 160 个字符。");
  }
  return detail;
}

function normalizeSource(value) {
  return value === "chat" ? "chat" : "manual";
}

function parseAmountMinor(value, label, options = {}) {
  const normalized = String(value ?? "").trim().replaceAll(",", "");
  if (normalized.length > 24) {
    throw new HttpError(400, "WALLET_AMOUNT_TOO_LARGE", `${label}超出可记录范围。`);
  }
  const pattern = options.signed
    ? /^[+-]?\d+(?:\.\d{1,2})?$/
    : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(normalized)) {
    throw new HttpError(400, "WALLET_AMOUNT_INVALID", `${label}必须是最多两位小数的数字。`);
  }
  const sign = normalized.startsWith("-") ? -1 : 1;
  const unsigned = normalized.replace(/^[+-]/, "");
  const [whole, fraction = ""] = unsigned.split(".");
  const minor = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * sign;
  if (!Number.isSafeInteger(minor) || Math.abs(minor) > MAX_BALANCE_MINOR) {
    throw new HttpError(400, "WALLET_AMOUNT_TOO_LARGE", `${label}超出可记录范围。`);
  }
  return minor;
}

module.exports = { WalletService, parseAmountMinor };
