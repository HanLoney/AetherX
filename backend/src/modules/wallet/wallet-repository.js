class WalletRepository {
  constructor(database) {
    this.database = database;
  }

  list(userId) {
    return this.database
      .prepare(
        `SELECT id, name, balance_minor, currency, note, created_at, updated_at
         FROM wallet_accounts
         WHERE user_id = ?
         ORDER BY updated_at DESC, created_at DESC, id`
      )
      .all(userId)
      .map(mapAccount);
  }

  findById(userId, id) {
    return mapAccount(
      this.database
        .prepare(
          `SELECT id, name, balance_minor, currency, note, created_at, updated_at
           FROM wallet_accounts
           WHERE user_id = ? AND id = ?`
        )
        .get(userId, id)
    );
  }

  create(userId, account) {
    this.database
      .prepare(
        `INSERT INTO wallet_accounts(
          id, user_id, name, balance_minor, currency, note, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        account.id,
        userId,
        account.name,
        account.balanceMinor,
        account.currency,
        account.note,
        account.createdAt,
        account.updatedAt
      );
    return this.findById(userId, account.id);
  }

  update(userId, id, changes) {
    const current = this.findById(userId, id);
    if (!current) return null;
    const next = { ...current, ...changes, updatedAt: Date.now() };
    this.database
      .prepare(
        `UPDATE wallet_accounts
         SET name = ?, balance_minor = ?, currency = ?, note = ?, updated_at = ?
         WHERE user_id = ? AND id = ?`
      )
      .run(
        next.name,
        next.balanceMinor,
        next.currency,
        next.note,
        next.updatedAt,
        userId,
        id
      );
    return this.findById(userId, id);
  }

  delete(userId, id) {
    return this.database
      .prepare("DELETE FROM wallet_accounts WHERE user_id = ? AND id = ?")
      .run(userId, id).changes > 0;
  }

  transaction(callback) {
    if (this.database.isTransaction) return callback();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = callback();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  recordTransaction(userId, transaction) {
    this.database
      .prepare(
        `INSERT INTO wallet_transactions(
          id, user_id, account_id, event_type, change_minor,
          balance_before_minor, balance_after_minor, previous_currency,
          currency, detail, source, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        transaction.id,
        userId,
        transaction.accountId,
        transaction.eventType,
        transaction.changeMinor,
        transaction.balanceBeforeMinor,
        transaction.balanceAfterMinor,
        transaction.previousCurrency,
        transaction.currency,
        transaction.detail,
        transaction.source,
        transaction.createdAt
      );
  }

  listTransactions(userId, accountId, limit = 50) {
    return this.database
      .prepare(
        `SELECT id, account_id, event_type, change_minor,
                balance_before_minor, balance_after_minor,
                previous_currency, currency, detail, source, created_at
         FROM wallet_transactions
         WHERE user_id = ? AND account_id = ?
         ORDER BY created_at DESC, rowid DESC
         LIMIT ?`
      )
      .all(userId, accountId, limit)
      .map(mapTransaction);
  }

  listTransactionsChronological(userId, accountId) {
    return this.database
      .prepare(
        `SELECT id, account_id, event_type, change_minor,
                balance_before_minor, balance_after_minor,
                previous_currency, currency, detail, source, created_at
         FROM wallet_transactions
         WHERE user_id = ? AND account_id = ?
         ORDER BY created_at ASC, rowid ASC`
      )
      .all(userId, accountId)
      .map(mapTransaction);
  }

  findTransaction(userId, accountId, transactionId) {
    return mapTransaction(
      this.database
        .prepare(
          `SELECT id, account_id, event_type, change_minor,
                  balance_before_minor, balance_after_minor,
                  previous_currency, currency, detail, source, created_at
           FROM wallet_transactions
           WHERE user_id = ? AND account_id = ? AND id = ?`
        )
        .get(userId, accountId, transactionId)
    );
  }

  updateTransaction(userId, accountId, transactionId, changes) {
    this.database
      .prepare(
        `UPDATE wallet_transactions
         SET event_type = ?, change_minor = ?, detail = ?
         WHERE user_id = ? AND account_id = ? AND id = ?`
      )
      .run(
        changes.eventType,
        changes.changeMinor,
        changes.detail,
        userId,
        accountId,
        transactionId
      );
    return this.findTransaction(userId, accountId, transactionId);
  }

  updateTransactionBalances(userId, accountId, transactionId, balanceBeforeMinor, balanceAfterMinor) {
    this.database
      .prepare(
        `UPDATE wallet_transactions
         SET balance_before_minor = ?, balance_after_minor = ?
         WHERE user_id = ? AND account_id = ? AND id = ?`
      )
      .run(balanceBeforeMinor, balanceAfterMinor, userId, accountId, transactionId);
  }
}

function mapAccount(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    balanceMinor: Number(row.balance_minor),
    amount: Number(row.balance_minor) / 100,
    currency: row.currency,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapTransaction(row) {
  return {
    id: row.id,
    accountId: row.account_id,
    eventType: row.event_type,
    changeMinor: row.change_minor == null ? null : Number(row.change_minor),
    change: row.change_minor == null ? null : Number(row.change_minor) / 100,
    balanceBeforeMinor: Number(row.balance_before_minor),
    balanceBefore: Number(row.balance_before_minor) / 100,
    balanceAfterMinor: Number(row.balance_after_minor),
    balanceAfter: Number(row.balance_after_minor) / 100,
    previousCurrency: row.previous_currency,
    currency: row.currency,
    detail: row.detail,
    source: row.source,
    createdAt: row.created_at
  };
}

module.exports = { WalletRepository };
