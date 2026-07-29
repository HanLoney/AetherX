if (new URLSearchParams(window.location.search).has("embedded")) {
  document.body.classList.add("embedded");
  if (!window.desktop && window.parent?.desktop) window.desktop = window.parent.desktop;
}

const state = {
  summary: { accountCount: 0, totals: {}, accounts: [] },
  selectedId: "",
  editingId: "",
  transactions: [],
  transactionLoadId: 0,
  transactionKind: "income",
  transactionSaving: false,
  saving: false,
  deleteArmed: false,
  deleteTimer: 0
};

const elements = {
  accountCount: document.querySelector("#accountCount"),
  primaryCurrencyLabel: document.querySelector("#primaryCurrencyLabel"),
  primaryTotal: document.querySelector("#primaryTotal"),
  currencyTotals: document.querySelector("#currencyTotals"),
  syncState: document.querySelector("#syncState"),
  accountList: document.querySelector("#accountList"),
  accountTemplate: document.querySelector("#accountTemplate"),
  ledgerTitle: document.querySelector("#ledgerTitle"),
  ledgerBalance: document.querySelector("#ledgerBalance"),
  ledgerNote: document.querySelector("#ledgerNote"),
  editAccountBtn: document.querySelector("#editAccountBtn"),
  addTransactionBtn: document.querySelector("#addTransactionBtn"),
  accountDialog: document.querySelector("#accountDialog"),
  form: document.querySelector("#accountForm"),
  editorEyebrow: document.querySelector("#editorEyebrow"),
  editorTitle: document.querySelector("#editorTitle"),
  nameInput: document.querySelector("#nameInput"),
  amountInput: document.querySelector("#amountInput"),
  currencyInput: document.querySelector("#currencyInput"),
  currencySymbol: document.querySelector("#currencySymbol"),
  noteInput: document.querySelector("#noteInput"),
  changeDetailInput: document.querySelector("#changeDetailInput"),
  transactionCount: document.querySelector("#transactionCount"),
  transactionList: document.querySelector("#transactionList"),
  transactionTemplate: document.querySelector("#transactionTemplate"),
  formMessage: document.querySelector("#formMessage"),
  saveBtn: document.querySelector("#saveAccountBtn"),
  deleteBtn: document.querySelector("#deleteAccountBtn"),
  newBtn: document.querySelector("#newAccountBtn"),
  transactionDialog: document.querySelector("#transactionDialog"),
  transactionForm: document.querySelector("#transactionForm"),
  transactionKindButtons: [...document.querySelectorAll(".transaction-kind button")],
  transactionCurrencySymbol: document.querySelector("#transactionCurrencySymbol"),
  transactionBalanceHint: document.querySelector("#transactionBalanceHint"),
  transactionAmountInput: document.querySelector("#transactionAmountInput"),
  transactionDetailInput: document.querySelector("#transactionDetailInput"),
  transactionMessage: document.querySelector("#transactionMessage"),
  saveTransactionBtn: document.querySelector("#saveTransactionBtn")
};

const CURRENCY_SYMBOLS = Object.freeze({ CNY: "¥", USD: "$", HKD: "HK$", JPY: "¥", EUR: "€" });
const ROW_ACCENTS = ["112,164,207", "194,151,82", "204,132,167", "104,177,149", "139,129,191"];

function formatMoney(amount, currency, withCurrency = false) {
  try {
    return new Intl.NumberFormat("zh-CN", {
      style: "currency",
      currency,
      currencyDisplay: withCurrency ? "code" : "symbol",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(Number(amount || 0));
  } catch {
    return `${currency} ${Number(amount || 0).toFixed(2)}`;
  }
}

function formatDateTime(value) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date(value));
}

function setSyncState(status, text) {
  elements.syncState.dataset.state = status;
  elements.syncState.replaceChildren(
    document.createElement("i"),
    document.createTextNode(text)
  );
}

function setMessage(type, text) {
  elements.formMessage.className = `form-message ${type || ""}`;
  elements.formMessage.textContent = text || "";
}

function selectedAccount() {
  return state.summary.accounts.find((account) => account.id === state.selectedId) || null;
}

function renderSummary() {
  elements.accountCount.textContent = `${state.summary.accountCount} 个账户`;
  const entries = Object.entries(state.summary.totals || {});
  const primary = entries.find(([currency]) => currency === "CNY") || entries[0] || ["CNY", { amount: 0 }];
  elements.primaryCurrencyLabel.textContent = `${primary[0]} 总余额`;
  elements.primaryTotal.textContent = formatMoney(primary[1].amount, primary[0]);
  elements.currencyTotals.replaceChildren(
    ...entries
      .filter(([currency]) => currency !== primary[0])
      .map(([currency, total]) => {
        const span = document.createElement("span");
        span.className = "currency-total";
        span.textContent = formatMoney(total.amount, currency, true);
        return span;
      })
  );
}

function renderAccounts() {
  elements.accountList.replaceChildren();
  if (!state.summary.accounts.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.innerHTML = "<i>¥</i><strong>钱包还是空的</strong><span>新建第一个账户，或者在聊天里告诉她。</span>";
    elements.accountList.append(empty);
    return;
  }
  state.summary.accounts.forEach((account, index) => {
    const row = elements.accountTemplate.content.firstElementChild.cloneNode(true);
    row.dataset.selected = String(account.id === state.selectedId);
    row.style.setProperty("--row-rgb", ROW_ACCENTS[index % ROW_ACCENTS.length]);
    row.querySelector(".account-copy strong").textContent = account.name;
    row.querySelector(".account-copy small").textContent = account.note || "没有备注";
    row.querySelector(".account-amount strong").textContent = formatMoney(account.amount, account.currency);
    row.querySelector(".account-amount small").textContent = account.currency;
    row.addEventListener("click", () => selectAccount(account.id));
    elements.accountList.append(row);
  });
}

function resetDeleteConfirmation() {
  clearTimeout(state.deleteTimer);
  state.deleteArmed = false;
  elements.deleteBtn.classList.remove("armed");
  elements.deleteBtn.textContent = "删除记录";
}

function prepareAccountDialog(account = null) {
  resetDeleteConfirmation();
  state.editingId = account?.id || "";
  elements.accountDialog.dataset.mode = account ? "edit" : "create";
  elements.editorEyebrow.textContent = account ? "SAVING DETAIL" : "NEW SAVING";
  elements.editorTitle.textContent = account ? "编辑账户资料" : "新建账户";
  elements.nameInput.value = account?.name || "";
  elements.amountInput.value = "";
  elements.currencyInput.value = account?.currency || "CNY";
  elements.noteInput.value = account?.note || "";
  elements.changeDetailInput.value = "";
  elements.currencySymbol.textContent = CURRENCY_SYMBOLS[elements.currencyInput.value] || elements.currencyInput.value;
  elements.deleteBtn.classList.toggle("hidden", !account);
  setMessage("", "");
}

function renderLedger() {
  const account = selectedAccount();
  elements.ledgerTitle.textContent = account?.name || "选择一个账户";
  elements.ledgerBalance.textContent = account
    ? formatMoney(account.amount, account.currency)
    : "—";
  elements.ledgerNote.textContent = account?.note || (
    account ? "这个账户还没有备注。" : "从左边选择一个账户后，这里会展开它的完整变化。"
  );
  elements.editAccountBtn.disabled = !account;
  elements.addTransactionBtn.disabled = !account;
}

function transactionAmount(transaction) {
  if (transaction.changeMinor === null) {
    return transaction.previousCurrency === transaction.currency
      ? "资料更新"
      : `${transaction.previousCurrency} → ${transaction.currency}`;
  }
  if (transaction.changeMinor === 0) return "资料更新";
  const prefix = transaction.changeMinor > 0 ? "+" : "−";
  return `${prefix}${formatMoney(Math.abs(transaction.change), transaction.currency)}`;
}

function renderTransactions({ loading = false } = {}) {
  elements.transactionList.replaceChildren();
  const account = selectedAccount();
  if (!account) {
    elements.transactionCount.textContent = "0 条";
    const empty = document.createElement("div");
    empty.className = "transaction-empty";
    empty.textContent = "新建账户后，会从第一笔余额开始记录。";
    elements.transactionList.append(empty);
    return;
  }
  if (loading) {
    elements.transactionCount.textContent = "读取中";
    const empty = document.createElement("div");
    empty.className = "transaction-empty";
    empty.textContent = "正在读取变动记录…";
    elements.transactionList.append(empty);
    return;
  }
  elements.transactionCount.textContent = `${state.transactions.length} 条`;
  if (!state.transactions.length) {
    const empty = document.createElement("div");
    empty.className = "transaction-empty";
    empty.textContent = "还没有变动记录。";
    elements.transactionList.append(empty);
    return;
  }
  for (const transaction of state.transactions) {
    const row = elements.transactionTemplate.content.firstElementChild.cloneNode(true);
    const kind = transaction.changeMinor > 0
      ? "positive"
      : transaction.changeMinor < 0
        ? "negative"
        : "neutral";
    row.dataset.kind = kind;
    row.querySelector(".transaction-copy strong").textContent = transaction.detail;
    row.querySelector(".transaction-copy small").textContent =
      `${transaction.source === "chat" ? "来自聊天" : "手动记录"} · ${formatDateTime(transaction.createdAt)}`;
    row.querySelector(".transaction-amount strong").textContent = transactionAmount(transaction);
    row.querySelector(".transaction-amount small").textContent =
      `余额 ${formatMoney(transaction.balanceBefore, transaction.previousCurrency)} → ${formatMoney(transaction.balanceAfter, transaction.currency)}`;
    elements.transactionList.append(row);
  }
}

function render() {
  renderSummary();
  renderAccounts();
  renderLedger();
  renderTransactions();
}

async function loadTransactions(accountId = state.selectedId) {
  const loadId = ++state.transactionLoadId;
  state.transactions = [];
  if (!accountId) {
    renderTransactions();
    return;
  }
  renderTransactions({ loading: true });
  try {
    const transactions = await window.desktop.listWalletTransactions(accountId, { limit: 500 });
    if (loadId !== state.transactionLoadId || accountId !== state.selectedId) return;
    state.transactions = transactions;
    renderTransactions();
  } catch (error) {
    if (loadId !== state.transactionLoadId || accountId !== state.selectedId) return;
    elements.transactionCount.textContent = "读取失败";
    elements.transactionList.replaceChildren();
    const empty = document.createElement("div");
    empty.className = "transaction-empty";
    empty.textContent = error.message || "变动记录暂时无法读取。";
    elements.transactionList.append(empty);
  }
}

function selectAccount(id) {
  state.selectedId = id;
  state.transactions = [];
  renderAccounts();
  renderLedger();
  void loadTransactions(id);
}

function beginCreate() {
  prepareAccountDialog();
  elements.accountDialog.showModal();
  window.setTimeout(() => elements.nameInput.focus(), 0);
}

function beginEdit() {
  const account = selectedAccount();
  if (!account) return;
  prepareAccountDialog(account);
  elements.accountDialog.showModal();
  window.setTimeout(() => elements.nameInput.focus(), 0);
}

function setTransactionKind(kind) {
  state.transactionKind = kind === "expense" ? "expense" : "income";
  for (const button of elements.transactionKindButtons) {
    button.dataset.selected = String(button.dataset.kind === state.transactionKind);
  }
}

function beginTransaction() {
  const account = selectedAccount();
  if (!account) return;
  setTransactionKind("income");
  elements.transactionCurrencySymbol.textContent = CURRENCY_SYMBOLS[account.currency] || account.currency;
  elements.transactionBalanceHint.textContent = `当前 ${formatMoney(account.amount, account.currency)}`;
  elements.transactionAmountInput.value = "";
  elements.transactionDetailInput.value = "";
  elements.transactionMessage.textContent = "";
  elements.transactionMessage.className = "form-message";
  elements.transactionDialog.showModal();
  window.setTimeout(() => elements.transactionAmountInput.focus(), 0);
}

async function refresh({ preserveSelection = true } = {}) {
  setSyncState("loading", "同步中");
  try {
    state.summary = await window.desktop.getWalletSummary();
    if (!preserveSelection || !state.summary.accounts.some((item) => item.id === state.selectedId)) {
      state.selectedId = state.summary.accounts[0]?.id || "";
    }
    state.transactions = [];
    render();
    await loadTransactions();
    setSyncState("ready", "已同步");
  } catch (error) {
    setSyncState("error", "同步失败");
    setMessage("error", error.message || "钱包暂时无法连接 Hub");
  }
}

async function saveAccount(event) {
  event.preventDefault();
  if (state.saving) return;
  const baseInput = {
    name: elements.nameInput.value.trim(),
    note: elements.noteInput.value.trim()
  };
  const input = state.editingId
    ? baseInput
    : {
        ...baseInput,
        amount: elements.amountInput.value.trim(),
        currency: elements.currencyInput.value,
        detail: elements.changeDetailInput.value.trim()
      };
  state.saving = true;
  elements.saveBtn.disabled = true;
  elements.saveBtn.textContent = "保存中…";
  setMessage("", "");
  try {
    const account = state.editingId
      ? await window.desktop.updateWalletAccount(state.editingId, input)
      : await window.desktop.createWalletAccount(input);
    state.selectedId = account.id;
    await refresh();
    elements.accountDialog.close();
  } catch (error) {
    setMessage("error", error.message || "保存失败");
  } finally {
    state.saving = false;
    elements.saveBtn.disabled = false;
    elements.saveBtn.textContent = "保存";
  }
}

async function deleteAccount() {
  if (!state.editingId || state.saving) return;
  if (!state.deleteArmed) {
    state.deleteArmed = true;
    elements.deleteBtn.classList.add("armed");
    elements.deleteBtn.textContent = "再次点击确认";
    state.deleteTimer = window.setTimeout(resetDeleteConfirmation, 3200);
    return;
  }
  state.saving = true;
  try {
    await window.desktop.deleteWalletAccount(state.editingId);
    state.selectedId = "";
    state.editingId = "";
    await refresh({ preserveSelection: false });
    elements.accountDialog.close();
  } catch (error) {
    setMessage("error", error.message || "删除失败");
  } finally {
    state.saving = false;
    resetDeleteConfirmation();
  }
}

async function saveTransaction(event) {
  event.preventDefault();
  const account = selectedAccount();
  if (!account || state.transactionSaving) return;
  const amount = elements.transactionAmountInput.value.trim();
  if (!/^\d+(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0) {
    elements.transactionMessage.className = "form-message error";
    elements.transactionMessage.textContent = "请输入大于零、最多两位小数的金额。";
    return;
  }
  state.transactionSaving = true;
  elements.saveTransactionBtn.disabled = true;
  elements.saveTransactionBtn.textContent = "记录中…";
  elements.transactionMessage.textContent = "";
  try {
    await window.desktop.adjustWalletAccount(account.id, {
      change: state.transactionKind === "expense" ? `-${amount}` : amount,
      detail: elements.transactionDetailInput.value.trim()
    });
    await refresh();
    elements.transactionDialog.close();
  } catch (error) {
    elements.transactionMessage.className = "form-message error";
    elements.transactionMessage.textContent = error.message || "这笔变动没有记录成功。";
  } finally {
    state.transactionSaving = false;
    elements.saveTransactionBtn.disabled = false;
    elements.saveTransactionBtn.textContent = "记入流水";
  }
}

elements.form.addEventListener("submit", saveAccount);
elements.transactionForm.addEventListener("submit", saveTransaction);
elements.newBtn.addEventListener("click", beginCreate);
elements.editAccountBtn.addEventListener("click", beginEdit);
elements.addTransactionBtn.addEventListener("click", beginTransaction);
elements.deleteBtn.addEventListener("click", deleteAccount);
for (const button of elements.transactionKindButtons) {
  button.addEventListener("click", () => setTransactionKind(button.dataset.kind));
}
for (const button of document.querySelectorAll("[data-close-dialog]")) {
  button.addEventListener("click", () => document.querySelector(`#${button.dataset.closeDialog}`)?.close());
}
for (const dialog of [elements.accountDialog, elements.transactionDialog]) {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}
elements.currencyInput.addEventListener("change", () => {
  elements.currencySymbol.textContent = CURRENCY_SYMBOLS[elements.currencyInput.value] || elements.currencyInput.value;
});
document.querySelector("#minimizeBtn").addEventListener("click", () => window.desktop.minimize());
document.querySelector("#maximizeBtn").addEventListener("click", () => window.desktop.maximize());
document.querySelector("#closeBtn").addEventListener("click", () => window.desktop.close());
window.addEventListener("message", (event) => {
  if (event.data?.type === "xuan:refresh-wallet") void refresh();
});
const unsubscribeSync = typeof window.desktop?.onSyncChanges === "function"
  ? window.desktop.onSyncChanges((changes) => {
      if (changes?.some((change) =>
        ["wallet_accounts", "wallet_transactions"].includes(change.entityType)
      )) void refresh();
    })
  : null;
window.addEventListener("beforeunload", () => {
  clearTimeout(state.deleteTimer);
  unsubscribeSync?.();
});

refresh({ preserveSelection: false });
