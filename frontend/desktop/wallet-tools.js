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
      title: "查看存款",
      description: "查询钱包中的所有存款项、各项余额和按币种汇总的总额。修改存款前应先调用此工具取得准确 ID。",
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
      title: "修改存款",
      description: "修改已有存款项的名称、当前余额、币种或备注。若余额发生变化，应在 detail 中写明原因。必须使用 wallet.list 返回的准确 ID。",
      risk: "write",
      inputSchema: objectSchema({
        id: stringField("存款项 ID"),
        name: stringField("新名称"),
        amount: numberField("新的当前余额"),
        currency: stringField("新的币种代码"),
        note: stringField("新的长期备注"),
        detail: stringField("可选的本次修改说明")
      }, ["id"]),
      async execute(input) {
        try {
          const { id, ...changes } = input;
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
      title: "调整存款余额",
      description: "按增减额调整一项存款。存入使用正数，取出使用负数，并在 detail 中说明这笔变动；必须先查询并使用准确 ID。",
      risk: "write",
      inputSchema: objectSchema({
        id: stringField("存款项 ID"),
        change: numberField("余额变化量，正数为增加，负数为减少"),
        detail: stringField("可选的变动说明，例如工资存入、购买设备")
      }, ["id", "change"]),
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
