const { randomUUID } = require("node:crypto");

class ReplicatedWalletService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  list(userId) {
    return this.service.list(userId);
  }

  summary(userId) {
    return this.service.summary(userId);
  }

  get(userId, id) {
    return this.service.get(userId, id);
  }

  listTransactions(userId, id, filters = {}) {
    return this.service.listTransactions(userId, id, filters);
  }

  getTransaction(userId, accountId, transactionId) {
    return this.service.getTransaction(userId, accountId, transactionId);
  }

  create(userId, input = {}, options = {}) {
    return this.createWithRequestId(userId, input, internalRequestId(), options).result;
  }

  createWithRequestId(userId, input, requestId, options = {}) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const account = this.service.create(userId, input, options);
      const transactions = this.allTransactions(userId, account.id);
      return {
        status: 201,
        result: account,
        changes: [walletAccountUpsert(account), ...transactions.map(walletTransactionUpsert)]
      };
    });
  }

  update(userId, id, input = {}, options = {}) {
    return this.updateWithRequestId(userId, id, input, internalRequestId(), options).result;
  }

  updateWithRequestId(userId, id, input, requestId, options = {}) {
    return this.mutateAccount(userId, id, requestId, () =>
      this.service.update(userId, id, input, options)
    );
  }

  adjust(userId, id, input = {}, options = {}) {
    return this.adjustWithRequestId(userId, id, input, internalRequestId(), options).result;
  }

  adjustWithRequestId(userId, id, input, requestId, options = {}) {
    return this.mutateAccount(userId, id, requestId, () =>
      this.service.adjust(userId, id, input, options)
    );
  }

  updateTransaction(userId, accountId, transactionId, input = {}) {
    return this.updateTransactionWithRequestId(
      userId,
      accountId,
      transactionId,
      input,
      internalRequestId()
    ).result;
  }

  updateTransactionWithRequestId(userId, accountId, transactionId, input, requestId) {
    return this.mutateAccount(userId, accountId, requestId, () =>
      this.service.updateTransaction(userId, accountId, transactionId, input)
    );
  }

  delete(userId, id) {
    this.deleteWithRequestId(userId, id, internalRequestId());
  }

  deleteWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const account = this.service.get(userId, id);
      const transactions = this.allTransactions(userId, id);
      this.service.delete(userId, id);
      return {
        status: 204,
        result: null,
        changes: [
          ...transactions.map(walletTransactionDelete),
          walletAccountDelete(account)
        ]
      };
    });
  }

  mutateAccount(userId, id, requestId, mutation) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const beforeAccount = this.service.get(userId, id);
      const beforeTransactions = this.allTransactions(userId, id);
      const result = mutation();
      const account = result?.account || result;
      const afterTransactions = this.allTransactions(userId, id);
      const changes = [];
      if (!sameValue(beforeAccount, account)) changes.push(walletAccountUpsert(account));
      const beforeById = new Map(beforeTransactions.map((item) => [item.id, item]));
      for (const transaction of afterTransactions) {
        if (!sameValue(beforeById.get(transaction.id), transaction)) {
          changes.push(walletTransactionUpsert(transaction));
        }
        beforeById.delete(transaction.id);
      }
      for (const removed of beforeById.values()) {
        changes.push(walletTransactionDelete(removed));
      }
      return { result, changes };
    });
  }

  allTransactions(userId, accountId) {
    return this.service.repository.listTransactionsChronological(userId, accountId);
  }
}

function walletAccountUpsert(account) {
  return {
    entityType: "wallet_accounts",
    entityId: account.id,
    operation: "upsert",
    payload: {
      id: account.id,
      name: account.name,
      balance_minor: account.balanceMinor,
      currency: account.currency,
      note: account.note,
      created_at: account.createdAt,
      updated_at: account.updatedAt
    }
  };
}

function walletAccountDelete(account) {
  return {
    entityType: "wallet_accounts",
    entityId: account.id,
    operation: "delete",
    payload: { id: account.id, deleted_version_updated_at: account.updatedAt }
  };
}

function walletTransactionUpsert(transaction) {
  return {
    entityType: "wallet_transactions",
    entityId: transaction.id,
    operation: "upsert",
    payload: {
      id: transaction.id,
      account_id: transaction.accountId,
      event_type: transaction.eventType,
      change_minor: transaction.changeMinor,
      balance_before_minor: transaction.balanceBeforeMinor,
      balance_after_minor: transaction.balanceAfterMinor,
      previous_currency: transaction.previousCurrency,
      currency: transaction.currency,
      detail: transaction.detail,
      source: transaction.source,
      created_at: transaction.createdAt
    }
  };
}

function walletTransactionDelete(transaction) {
  return {
    entityType: "wallet_transactions",
    entityId: transaction.id,
    operation: "delete",
    payload: {
      id: transaction.id,
      account_id: transaction.accountId,
      deleted_version_created_at: transaction.createdAt
    }
  };
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = {
  ReplicatedWalletService,
  walletAccountDelete,
  walletAccountUpsert,
  walletTransactionDelete,
  walletTransactionUpsert
};
