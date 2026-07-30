(function exposeWalletTools(global) {
  const objectSchema = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
  const stringField = (description) => ({ type: "string", description });
  const numberField = (description) => ({ type: "number", description });

  function failure(error) {
    return {
      ok: false,
      content: error.message || "钱包请求失败。",
      error: {
        code: error.code || "WALLET_API_ERROR",
        message: error.message || "钱包请求失败。"
      }
    };
  }

  function formatMoney(amount, currency) {
    try {
      return new Intl.NumberFormat("zh-CN", {
        style: "currency",
        currency,
        minimumFractionDigits: 2
      }).format(amount);
    } catch {
      return `${currency} ${Number(amount).toFixed(2)}`;
    }
  }

  function registerWalletTools(registry) {
    registry.register({
      name: "wallet.list",
      title: "查看钱包账户",
      description: "查询钱包中的所有账户、各项余额和按币种汇总的总额。修改账户或流水前应先调用此工具取得准确的账户 ID。",
      risk: "read",
      inputSchema: objectSchema({}),
      async execute() {
        try {
          const summary = await global.desktop.getWalletSummary();
          const totals = Object.entries(summary.totals || {}).map(
            ([currency, total]) => formatMoney(total.amount, currency)
          );
          return {
            ok: true,
            content: summary.accountCount
              ? `钱包里有 ${summary.accountCount} 项存款，总额为 ${totals.join("、")}。`
              : "钱包里还没有存款记录。",
            data: summary
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "wallet.transactions",
      title: "查看账户流水",
      description: "查询某个钱包账户的逐笔收入、支出与修改记录，返回每笔流水的准确 ID、金额、说明和余额。修改某一笔记录前必须先调用此工具。",
      risk: "read",
      inputSchema: objectSchema({
        id: stringField("wallet.list 返回的账户 ID")
      }, ["id"]),
      async execute(input) {
        try {
          const transactions = await global.desktop.listWalletTransactions(input.id, { limit: 500 });
          return {
            ok: true,
            content: transactions.length
              ? `找到了 ${transactions.length} 笔流水。修改时请使用返回的 transaction id。`
              : "这个账户还没有流水记录。",
            data: transactions
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "wallet.create",
      title: "记录存款",
      description: "在钱包中新增一项独立存款，例如银行卡、现金、旅行基金或其他储蓄账户。",
      risk: "write",
      inputSchema: objectSchema({
        name: stringField("存款项名称"),
        amount: numberField("当前余额，最多两位小数且不能为负数"),
        currency: stringField("三个字母的币种代码，默认 CNY"),
        note: stringField("可选的长期备注"),
        detail: stringField("可选的初始余额说明，例如工资结余或原有存款")
      }, ["name", "amount"]),
      async execute(input) {
        try {
          const account = await global.desktop.createWalletAccount(input);
          return {
            ok: true,
            content: `已记录“${account.name}”，当前余额 ${formatMoney(account.amount, account.currency)}。`,
            data: account
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "wallet.update",
      title: "编辑账户资料",
      description: "只修改钱包账户的名称或长期备注，不能用于修改余额、收入、支出或某笔流水。修改钱款必须使用 wallet.adjust 或 wallet.transaction.update。",
      risk: "write",
      inputSchema: objectSchema({
        id: stringField("存款项 ID"),
        name: stringField("新名称"),
        note: stringField("新的长期备注")
      }, ["id"]),
      async execute(input) {
        try {
          const { id, ...changes } = input;
          if (!Object.keys(changes).length) {
            const error = new Error("没有提供要修改的账户资料；如果要修改某笔收支，请先查询账户流水。");
            error.code = "WALLET_ACCOUNT_CHANGES_REQUIRED";
            return failure(error);
          }
          const account = await global.desktop.updateWalletAccount(id, changes);
          return {
            ok: true,
            content: `已更新“${account.name}”，当前余额 ${formatMoney(account.amount, account.currency)}。`,
            data: account
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "wallet.adjust",
      title: "记录收入或支出",
      description: "新增一笔收入或支出。收入使用正数，支出使用负数，detail 必须说明用途；金额必须逐位采用用户给出的原值，不得自行取整或四舍五入。这是新增流水，不用于修改已经存在的旧流水。",
      risk: "write",
      inputSchema: objectSchema({
        id: stringField("存款项 ID"),
        change: numberField("用户给出的精确余额变化量，正数为增加，负数为减少，不得改写小数"),
        detail: stringField("变动说明，例如工资存入、购买设备")
      }, ["id", "change", "detail"]),
      async execute(input) {
        try {
          const account = await global.desktop.adjustWalletAccount(input.id, {
            change: input.change,
            ...(input.detail === undefined ? {} : { detail: input.detail })
          });
          return {
            ok: true,
            content: `已调整“${account.name}”，当前余额 ${formatMoney(account.amount, account.currency)}。`,
            data: account
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "wallet.transaction.update",
      title: "修改一笔钱包流水",
      description: "精确修改一笔已经存在的收入、支出或初始余额，可以改金额和说明。必须先调用 wallet.transactions 取得 accountId 和 transactionId；金额必须逐位采用用户给出的原值，不得自行取整或四舍五入；修改后系统会自动重算后续流水与账户余额。",
      risk: "write",
      inputSchema: objectSchema({
        accountId: stringField("wallet.list 返回的账户 ID"),
        transactionId: stringField("wallet.transactions 返回的流水 ID"),
        change: numberField("用户给出的精确整笔变化量，收入为正数、支出为负数；不是差额，不得改写小数"),
        detail: stringField("修改后的流水说明")
      }, ["accountId", "transactionId"]),
      async execute(input) {
        try {
          const changes = {};
          if (input.change !== undefined) changes.change = input.change;
          if (input.detail !== undefined) changes.detail = input.detail;
          if (!Object.keys(changes).length) {
            const error = new Error("没有提供要修改的流水金额或说明。");
            error.code = "WALLET_TRANSACTION_CHANGES_REQUIRED";
            return failure(error);
          }
          const result = await global.desktop.updateWalletTransaction(
            input.accountId,
            input.transactionId,
            changes
          );
          return {
            ok: true,
            content: `已修改“${result.transaction.detail}”，账户当前余额 ${formatMoney(result.account.amount, result.account.currency)}。`,
            data: result
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    registry.register({
      name: "wallet.delete",
      title: "删除存款记录",
      description: "永久删除一项存款记录。必须先查询并使用准确 ID。",
      risk: "destructive",
      inputSchema: objectSchema({ id: stringField("存款项 ID") }, ["id"]),
      async execute(input) {
        try {
          await global.desktop.deleteWalletAccount(input.id);
          return {
            ok: true,
            content: "已删除这项存款记录。",
            data: { id: input.id }
          };
        } catch (error) {
          return failure(error);
        }
      }
    });

    return registry;
  }

  global.registerWalletTools = registerWalletTools;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { registerWalletTools };
  }
})(typeof window === "undefined" ? globalThis : window);
