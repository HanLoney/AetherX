import { Capacitor } from "@capacitor/core";
import {
  AetherApi,
  ApiError,
  type AuthUser,
  type AgentChatResult,
  type ChatMessage,
  type ClusterStatus,
  type Conversation,
  type ConversationPage,
  type GalleryImage,
  type Journal,
  type Memory,
  type ModuleState,
  type Todo
} from "./api";
import { useLocalHub } from "./local-hub";
import {
  createLocalToolRegistry,
  type LocalToolDefinition,
  type LocalToolRegistry,
  type LocalToolResult
} from "./local-agent-runtime";
import { validateLocalMutation, validateLocalMutations } from "./local-mutation-validator";

const CURRENT_USER = "__CURRENT_USER__";
const AGENT_PERMISSION_SETTING_ID = "__agent_auto_approve_writes__";
const DEFAULT_AI_CONFIG = Object.freeze({
  providerId: "openai",
  providerName: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4-mini"
});
const DEFAULT_IMAGE_CONFIG = Object.freeze({
  providerId: "volcengine",
  providerName: "火山方舟",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  model: "doubao-seedream-5-0-260128"
});

interface LocalModuleDefinition {
  id: string;
  name: string;
  description: string;
  core: boolean;
  defaultEnabled: boolean;
  dependencies: readonly string[];
}

interface LocalMutation {
  entityType: string;
  entityId: string;
  operation?: "upsert" | "delete";
  payload?: Record<string, unknown>;
  documentPayload?: Record<string, unknown>;
}

const LOCAL_MODULE_MANIFEST: readonly LocalModuleDefinition[] = [
  localModule("ai", "聊天", "负责对话、理解意图并调度已启用的能力。", { core: true }),
  localModule("memory", "记忆中心", "管理长期记忆、偏好、共同经历与人格成长记录。"),
  localModule("todo", "日历待办", "管理日程、待办、完成状态与跨日期安排。"),
  localModule("wallet", "钱包", "记录多项存款余额，并支持在对话中查询和调整。"),
  localModule("image-generation", "图像生成", "调用独立图像模型生成并保存图片。"),
  localModule("time-awareness", "时间感知", "为对话提供用户当地时间、时区和交互间隔。"),
  localModule("xuan-mood", "她的心情", "根据真实互动维护连续变化的心情状态。"),
  localModule("proactive-reminders", "主动提醒", "根据待办时间主动发送提醒。", { dependencies: ["todo"] }),
  localModule("autonomous-journal", "自主手记", "读取真实历史并生成日记、周记。"),
  localModule("anniversary-album", "我们的纪念册", "整理共同经历并形成可回顾的纪念时间轴。"),
  localModule("dreams", "梦境", "根据真实素材生成明确标记为虚构的梦境。")
];
const LOCAL_MODULE_BY_ID = new Map(LOCAL_MODULE_MANIFEST.map((module) => [module.id, module]));
const LOCAL_PROFILE_LABELS: Record<string, string> = {
  displayName: "姓名",
  preferredName: "称呼",
  birthday: "生日",
  occupation: "职业 / 身份",
  bio: "个人简介",
  goals: "长期目标"
};
const LOCAL_PREFERENCE_CATEGORIES = ["communication", "life", "food", "work", "entertainment", "other"];
const LOCAL_ASSISTANT_PROFILE_FIELDS = new Map([
  ["name", "名字"],
  ["gender", "性别认同"],
  ["selfDefinition", "自我定位"],
  ["relationshipSummary", "关系定位"]
]);
const LOCAL_MOOD_TONES = new Set(["calm", "clingy", "focused", "tired", "happy", "worried", "quiet"]);

export class LocalHubClient extends AetherApi {
  readonly isLocalHub = true;
  private readonly localHub: ReturnType<typeof useLocalHub>;
  private readonly pendingAgentRuns = new Map<string, LocalAgentRun>();
  private singleConversationMigration: Promise<void> | null = null;

  constructor(
    private readonly localUser: AuthUser,
    localHub: ReturnType<typeof useLocalHub> = useLocalHub()
  ) {
    super({ baseUrl: "http://127.0.0.1", token: "local-hub" });
    this.localHub = localHub;
  }

  get serverUrl() { return "capacitor://local-hub"; }
  get accessToken() { return "local-hub"; }

  health() { return Promise.resolve({ status: "ok", service: "aetherx-android-local-hub" }); }
  session() { return Promise.resolve({ user: this.localUser }); }

  async clusterStatus(): Promise<ClusterStatus> {
    const status = await this.localHub.refresh();
    if (!status?.configured) throw localUnavailable();
    return {
      spaceId: status.spaceId,
      localNodeId: status.localNodeId,
      activeNodeId: status.activeNodeId,
      epoch: status.epoch,
      state: status.state,
      localRole: status.role === "active" ? "active" : "standby",
      transitionId: "",
      transitionTargetNodeId: "",
      nodes: []
    };
  }

  ensureActiveHub() { return this.clusterStatus().then((status) => {
    if (status.localRole !== "active") throw localNotActive();
    return status;
  }); }

  routeToActiveHub() { return Promise.resolve(false); }

  async listTodos(status = "all"): Promise<Todo[]> {
    const rows = (await this.rows("todos")).map(todoFromRow);
    return rows
      .filter((todo) => status === "all" || (status === "completed" ? todo.completed : !todo.completed))
      .sort((left, right) => left.startAt - right.startAt || left.createdAt - right.createdAt);
  }

  async createTodo(input: { text: string; startAt: number; endAt: number }): Promise<Todo> {
    const now = Date.now();
    const todo: Todo = {
      id: crypto.randomUUID(),
      text: String(input.text || "").trim(),
      startAt: Number(input.startAt),
      endAt: Number(input.endAt),
      completed: false,
      createdAt: now,
      updatedAt: now
    };
    await this.mutate("todos", todo.id, todoPayload(todo), todoRow(todo));
    return todo;
  }

  async updateTodo(id: string, input: Partial<Todo>): Promise<Todo> {
    const current = (await this.listTodos()).find((todo) => todo.id === id);
    if (!current) throw new ApiError("没有找到这条待办。", 404, "TODO_NOT_FOUND");
    const todo = { ...current, ...input, id, updatedAt: Date.now() };
    await this.mutate("todos", id, todoPayload(todo), todoRow(todo));
    return todo;
  }

  async deleteTodo(id: string) {
    const current = (await this.listTodos()).find((todo) => todo.id === id);
    if (!current) throw new ApiError("没有找到这条待办。", 404, "TODO_NOT_FOUND");
    await this.mutate("todos", id, { id, deleted_version_updated_at: current.updatedAt }, {}, "delete");
    return null;
  }

  async profile() {
    const row = (await this.rows("user_profiles"))[0];
    return profileFromRow(row);
  }

  async updateProfile(input: Record<string, unknown>) {
    const current = await this.profile();
    const next = { ...current, ...input, updatedAt: Date.now() };
    const payload = {
      display_name: next.displayName,
      preferred_name: next.preferredName,
      birthday: next.birthday,
      bio: next.bio,
      occupation: next.occupation,
      goals: next.goals,
      avatar_data_url: next.avatarDataUrl,
      updated_at: next.updatedAt
    };
    const row = { ...payload, user_id: CURRENT_USER, goals_json: canonicalJson(next.goals) };
    delete (row as Record<string, unknown>).goals;
    await this.mutate("user_profiles", "profile", payload, row);
    return next;
  }

  async assistantProfile() {
    const row = (await this.rows("assistant_profiles"))[0];
    return assistantFromRow(row);
  }

  async updateAssistantProfile(input: Record<string, unknown>) {
    const current = await this.assistantProfile();
    const next = { ...current, ...input, updatedAt: Date.now() };
    const payload = {
      name: next.name,
      gender: next.gender,
      self_definition: next.selfDefinition,
      relationship_summary: next.relationshipSummary,
      traits: next.traits,
      values: next.values,
      avatar_data_url: next.avatarDataUrl,
      persona_image_data_url: next.personaImageDataUrl,
      updated_at: next.updatedAt
    };
    const row = {
      user_id: CURRENT_USER,
      name: next.name,
      gender: next.gender,
      self_definition: next.selfDefinition,
      relationship_summary: next.relationshipSummary,
      traits_json: canonicalJson(next.traits),
      values_json: canonicalJson(next.values),
      avatar_data_url: next.avatarDataUrl,
      persona_image_data_url: next.personaImageDataUrl,
      updated_at: next.updatedAt
    };
    await this.mutate("assistant_profiles", "profile", payload, row);
    return next;
  }

  async listMemories(filters: string | Record<string, any> = ""): Promise<Memory[]> {
    const query = typeof filters === "string" ? { status: filters } : filters;
    return (await this.rows("memories"))
      .map(memoryFromRow)
      .filter((memory) => !query.status || memory.status === query.status)
      .filter((memory) => !query.domain || memory.domain === query.domain)
      .filter((memory) => !query.type || memory.type === query.type)
      .sort((left, right) => right.importance - left.importance || right.updatedAt - left.updatedAt);
  }

  async confirmMemory(id: string): Promise<Memory> {
    const current = (await this.listMemories()).find((memory) => memory.id === id);
    if (!current) throw new ApiError("没有找到这条记忆。", 404, "MEMORY_NOT_FOUND");
    const next = { ...current, status: "active" as const, lastConfirmedAt: Date.now(), updatedAt: Date.now() };
    await this.mutate("memories", id, memoryPayload(next), memoryRow(next));
    return next;
  }

  async createMemory(input: Record<string, any>): Promise<Memory> {
    const now = Date.now();
    const memory = {
      id: crypto.randomUUID(),
      domain: String(input.domain || "life"),
      type: String(input.type || "fact"),
      content: String(input.content || "").trim(),
      sourceExcerpt: String(input.sourceExcerpt || input.content || ""),
      source: input.source || "explicit",
      confidence: Number(input.confidence ?? 1),
      importance: Number(input.importance ?? 0.7),
      status: input.status || "active",
      entities: Array.isArray(input.entities) ? input.entities : [],
      memoryKey: String(input.memoryKey || ""),
      mergeCount: 1,
      sensitivity: input.sensitivity || "normal",
      validFrom: input.validFrom || null,
      validUntil: input.validUntil || null,
      lastConfirmedAt: input.status === "active" ? now : null,
      createdAt: now,
      updatedAt: now
    } as Memory & Record<string, any>;
    if (!memory.content) throw new ApiError("记忆内容不能为空。", 400, "MEMORY_CONTENT_REQUIRED");
    await this.mutate("memories", memory.id, memoryPayload(memory), memoryRow(memory));
    return memory;
  }

  async updateMemory(id: string, input: Record<string, any>): Promise<Memory> {
    const current = (await this.listMemories()).find((memory) => memory.id === id);
    if (!current) throw new ApiError("没有找到这条记忆。", 404, "MEMORY_NOT_FOUND");
    const next = { ...current, ...input, id, updatedAt: Date.now() } as Memory & Record<string, any>;
    await this.mutate("memories", id, memoryPayload(next), memoryRow(next));
    return next;
  }

  async deleteMemory(id: string) {
    const current = (await this.listMemories()).find((memory) => memory.id === id);
    if (!current) throw new ApiError("没有找到这条记忆。", 404, "MEMORY_NOT_FOUND");
    await this.mutate("memories", id, { id, deleted_version_updated_at: current.updatedAt }, {}, "delete");
    return null;
  }

  async getWalletSummary() {
    const accounts = (await this.rows("wallet_accounts")).map(walletAccountFromRow);
    const totals: Record<string, { balanceMinor: number; amount: number }> = {};
    for (const account of accounts) {
      const total = totals[account.currency] || { balanceMinor: 0, amount: 0 };
      total.balanceMinor += account.balanceMinor;
      total.amount = total.balanceMinor / 100;
      totals[account.currency] = total;
    }
    return { accountCount: accounts.length, totals, accounts };
  }

  async listWalletTransactions(accountId: string) {
    return (await this.rows("wallet_transactions"))
      .map(walletTransactionFromRow)
      .filter((item) => item.accountId === accountId)
      .sort((left, right) => right.createdAt - left.createdAt || right.id.localeCompare(left.id));
  }

  async createWalletAccount(input: Record<string, any>) {
    const now = Date.now();
    const balanceMinor = amountMinor(input.amount ?? 0, false);
    const account = {
      id: crypto.randomUUID(),
      name: requiredText(input.name, "存款名称"),
      balanceMinor,
      amount: balanceMinor / 100,
      currency: currency(input.currency),
      note: String(input.note || "").trim().slice(0, 240),
      createdAt: now,
      updatedAt: now
    };
    const transaction = walletOpeningTransaction(account, String(input.detail || "记录初始余额"), now);
    await this.mutateBatch([
      walletAccountMutation(account),
      walletTransactionMutation(transaction)
    ]);
    return account;
  }

  async updateWalletAccount(id: string, input: Record<string, any>) {
    const summary = await this.getWalletSummary();
    const current = summary.accounts.find((item) => item.id === id);
    if (!current) throw new ApiError("没有找到这项存款。", 404, "WALLET_ACCOUNT_NOT_FOUND");
    const account = {
      ...current,
      ...(input.name === undefined ? {} : { name: requiredText(input.name, "存款名称") }),
      ...(input.note === undefined ? {} : { note: String(input.note || "").trim().slice(0, 240) }),
      updatedAt: Date.now()
    };
    await this.mutateBatch([walletAccountMutation(account)]);
    return account;
  }

  async adjustWalletAccount(id: string, input: Record<string, any>) {
    const summary = await this.getWalletSummary();
    const current = summary.accounts.find((item) => item.id === id);
    if (!current) throw new ApiError("没有找到这项存款。", 404, "WALLET_ACCOUNT_NOT_FOUND");
    const changeMinor = amountMinor(input.change, true);
    if (!changeMinor) throw new ApiError("调整金额不能为零。", 400, "WALLET_CHANGE_REQUIRED");
    const balanceMinor = current.balanceMinor + changeMinor;
    if (balanceMinor < 0) throw new ApiError("调整后余额不能小于零。", 400, "WALLET_BALANCE_NEGATIVE");
    const now = Date.now();
    const account = { ...current, balanceMinor, amount: balanceMinor / 100, updatedAt: now };
    const transaction = {
      id: crypto.randomUUID(),
      accountId: id,
      eventType: changeMinor > 0 ? "deposit" : "withdrawal",
      changeMinor,
      change: changeMinor / 100,
      balanceBeforeMinor: current.balanceMinor,
      balanceBefore: current.balanceMinor / 100,
      balanceAfterMinor: balanceMinor,
      balanceAfter: balanceMinor / 100,
      previousCurrency: current.currency,
      currency: current.currency,
      detail: String(input.detail || (changeMinor > 0 ? "增加存款" : "减少存款")).trim().slice(0, 160),
      source: "chat",
      createdAt: now
    };
    await this.mutateBatch([walletAccountMutation(account), walletTransactionMutation(transaction)]);
    return account;
  }

  async updateWalletTransaction(accountId: string, transactionId: string, input: Record<string, any>) {
    const summary = await this.getWalletSummary();
    const currentAccount = summary.accounts.find((item) => item.id === accountId);
    if (!currentAccount) throw new ApiError("没有找到这项存款。", 404, "WALLET_ACCOUNT_NOT_FOUND");
    const chronological = (await this.listWalletTransactions(accountId))
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
    const current = chronological.find((item) => item.id === transactionId);
    if (!current) throw new ApiError("没有找到这笔钱包流水。", 404, "WALLET_TRANSACTION_NOT_FOUND");
    const nextChange = input.change === undefined ? current.changeMinor : amountMinor(input.change, true);
    if (current.eventType === "create" && nextChange < 0) {
      throw new ApiError("初始余额不能改成负数。", 400, "WALLET_INITIAL_BALANCE_NEGATIVE");
    }
    if (current.eventType !== "create" && !nextChange) {
      throw new ApiError("收入或支出金额不能为零。", 400, "WALLET_CHANGE_REQUIRED");
    }
    const now = Date.now();
    let balance = 0;
    const updated = chronological.map((transaction) => {
      const change = transaction.id === transactionId ? nextChange : transaction.changeMinor;
      const before = balance;
      balance += change || 0;
      if (balance < 0) throw new ApiError("修改后，后续余额会变成负数。", 400, "WALLET_HISTORY_BALANCE_NEGATIVE");
      return {
        ...transaction,
        ...(transaction.id === transactionId
          ? {
              changeMinor: change,
              change: change / 100,
              detail: input.detail === undefined ? transaction.detail : String(input.detail).trim().slice(0, 160),
              eventType: transaction.eventType === "create" ? "create" : change > 0 ? "deposit" : "withdrawal"
            }
          : {}),
        balanceBeforeMinor: before,
        balanceBefore: before / 100,
        balanceAfterMinor: balance,
        balanceAfter: balance / 100
      };
    });
    const account = { ...currentAccount, balanceMinor: balance, amount: balance / 100, updatedAt: now };
    await this.mutateBatch([
      walletAccountMutation(account),
      ...updated.map(walletTransactionMutation)
    ]);
    return { account, transaction: updated.find((item) => item.id === transactionId)! };
  }

  async deleteWalletAccount(id: string) {
    const summary = await this.getWalletSummary();
    const account = summary.accounts.find((item) => item.id === id);
    if (!account) throw new ApiError("没有找到这项存款。", 404, "WALLET_ACCOUNT_NOT_FOUND");
    const transactions = await this.listWalletTransactions(id);
    await this.mutateBatch([
      ...transactions.map((item) => ({
        entityType: "wallet_transactions",
        entityId: item.id,
        operation: "delete" as const,
        payload: { id: item.id, account_id: id, deleted_version_created_at: item.createdAt },
        documentPayload: {}
      })),
      {
        entityType: "wallet_accounts",
        entityId: id,
        operation: "delete" as const,
        payload: { id, deleted_version_updated_at: account.updatedAt },
        documentPayload: {}
      }
    ]);
  }

  private async rawConversations(): Promise<Conversation[]> {
    return (await this.rows("conversations"))
      .map(conversationFromRow)
      .sort((left, right) => right.updatedAt - left.updatedAt || compareTextDescending(left.id, right.id));
  }

  private async allConversations(): Promise<Conversation[]> {
    await this.ensureSingleConversation();
    return this.rawConversations();
  }

  private async ensureSingleConversation() {
    if (this.singleConversationMigration) return this.singleConversationMigration;
    const migration = this.mergeConversationsIfNeeded();
    this.singleConversationMigration = migration;
    try {
      await migration;
    } finally {
      if (this.singleConversationMigration === migration) {
        this.singleConversationMigration = null;
      }
    }
  }

  private async mergeConversationsIfNeeded() {
    const conversations = await this.rawConversations();
    if (conversations.length <= 1) return;
    const status = await this.clusterStatus();
    if (status.localRole !== "active" || status.state !== "stable") return;

    const primary = conversations[0];
    const removed = conversations.slice(1);
    const conversationIds = new Set(conversations.map((item) => item.id));
    const removedIds = new Set(removed.map((item) => item.id));
    const [messageRows, evidenceRows] = await Promise.all([
      this.rows("messages"),
      this.rows("memory_evidence")
    ]);
    const messages = (["display", "model"] as const).flatMap((stream) =>
      messageRows
        .filter((row) => row.stream_type === stream && conversationIds.has(String(row.conversation_id || "")))
        .sort(compareMessageRows)
        .map((row, position) => messageMigration(row, primary.id, position))
    );
    const evidence = evidenceRows
      .filter((row) => removedIds.has(String(row.conversation_id || "")))
      .map((row) => memoryEvidenceMigration(row, primary.id));
    const mutations: LocalMutation[] = [
      conversationMigration(primary),
      ...messages,
      ...evidence,
      ...removed.map((conversation) => ({
        entityType: "conversations",
        entityId: conversation.id,
        operation: "delete" as const,
        payload: { id: conversation.id, deleted_version_updated_at: conversation.updatedAt },
        documentPayload: {}
      }))
    ];
    for (let offset = 0; offset < mutations.length; offset += 100) {
      await this.mutateBatch(mutations.slice(offset, offset + 100));
    }
  }

  async listConversations(): Promise<Conversation[]> {
    return (await this.allConversations()).slice(0, 1);
  }

  async conversationPage(offset = 0, limit = 12): Promise<ConversationPage> {
    const all = await this.listConversations();
    const items = all.slice(offset, offset + limit);
    return { items, total: all.length, offset, limit, hasMore: offset + items.length < all.length };
  }

  async conversation(id: string) {
    const conversation = (await this.allConversations()).find((item) => item.id === id);
    if (!conversation) throw new ApiError("没有找到这段对话。", 404, "CONVERSATION_NOT_FOUND");
    const messages = (await this.rows("messages", {
      payloadField: "conversation_id",
      payloadValue: id
    }))
      .sort((left, right) => Number(left.position) - Number(right.position));
    return {
      conversation,
      displayMessages: messages.filter((row) => row.stream_type === "display").map(messageFromRow),
      modelMessages: messages.filter((row) => row.stream_type === "model").map(messageFromRow)
    };
  }

  async conversationMessagePage(id: string, afterPosition = -1, limit = 500) {
    const current = await this.conversation(id);
    const boundedLimit = Math.max(1, Math.min(500, Math.trunc(Number(limit) || 500)));
    const after = Number.isFinite(Number(afterPosition)) ? Math.trunc(Number(afterPosition)) : -1;
    const messages = (await this.rows("messages", {
      payloadField: "conversation_id",
      payloadValue: id
    }))
      .filter((row) => row.stream_type === "display")
      .sort((left, right) => Number(left.position) - Number(right.position) || Number(left.created_at) - Number(right.created_at));
    const rows = messages.filter((row) => Number(row.position) > after);
    const pageRows = rows.slice(0, boundedLimit);
    const items = pageRows.map(messageFromRow);
    return {
      items,
      nextPosition: items.at(-1)?.position ?? after,
      hasMore: rows.length > boundedLimit,
      conversation: current.conversation
    };
  }

  async createConversation(title = "新对话") {
    const primary = (await this.listConversations())[0];
    if (primary) return primary;
    const now = Date.now();
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      title: String(title || "新对话").trim().slice(0, 120) || "新对话",
      summary: "",
      createdAt: now,
      updatedAt: now
    };
    await this.saveConversation(conversation);
    return conversation;
  }

  async saveConversationMessages(id: string, messages: ChatMessage[]) {
    const current = await this.conversation(id);
    for (const message of current.displayMessages) {
      if (message.id) await this.mutate("messages", message.id, {}, {}, "delete");
    }
    await this.saveMessageStream(id, "display", messages, 0);
    await this.saveConversation({
      ...current.conversation,
      updatedAt: Date.now()
    });
    return { saved: messages.length };
  }

  async deleteConversation(id: string) {
    const current = await this.conversation(id);
    for (const message of [...current.displayMessages, ...current.modelMessages]) {
      if (message.id) await this.mutate("messages", message.id, {}, {}, "delete");
    }
    await this.mutate("conversations", id, {}, {}, "delete");
    return null;
  }

  async listJournals(input: number | Record<string, any> = 1): Promise<Journal[]> {
    const filters = typeof input === "number" ? { limit: input } : input;
    return (await this.rows("assistant_journals"))
      .map(journalFromRow)
      .filter((item) => !filters.type || item.type === filters.type)
      .filter((item) => !filters.periodKey || item.periodKey === filters.periodKey)
      .sort((left, right) => right.sourceTo - left.sourceTo || right.updatedAt - left.updatedAt)
      .slice(0, Number(filters.limit || 100));
  }

  async saveJournal(input: Record<string, any>) {
    const now = Date.now();
    const id = String(input.id || crypto.randomUUID());
    const journal = {
      id,
      type: input.type || "daily",
      periodKey: String(input.periodKey || ""),
      title: String(input.title || "小玄手记"),
      content: String(input.content || ""),
      mood: String(input.mood || ""),
      sourceFrom: Number(input.sourceFrom || 0),
      sourceTo: Number(input.sourceTo || now),
      sourceMessageCount: Number(input.sourceMessageCount || 0),
      createdAt: Number(input.createdAt || now),
      updatedAt: now
    };
    const payload = {
      id, journal_type: journal.type, period_key: journal.periodKey, title: journal.title,
      content: journal.content, mood: journal.mood, source_from: journal.sourceFrom,
      source_to: journal.sourceTo, source_message_count: journal.sourceMessageCount,
      created_at: journal.createdAt, updated_at: journal.updatedAt
    };
    await this.mutate("assistant_journals", id, payload, { ...payload, user_id: CURRENT_USER });
    return journal;
  }

  async deleteJournal(id: string) {
    const current = (await this.listJournals(100)).find((item) => item.id === id);
    if (!current) throw new ApiError("未找到指定手记。", 404, "JOURNAL_NOT_FOUND");
    await this.mutate("assistant_journals", id, { id, deleted_version_updated_at: current.updatedAt }, {}, "delete");
  }

  async getJournalMaterial(from: number, to: number) {
    const conversations = await this.allConversations();
    const messages = (await this.rows("messages"))
      .filter((row) => row.stream_type === "display" && Number(row.created_at) >= from && Number(row.created_at) <= to)
      .map(messageFromRow);
    return { from, to, conversations, messages, messageCount: messages.length };
  }

  async listPersonalityEvents(filters: Record<string, any> = {}) {
    return (await this.rows("assistant_personality_events"))
      .map(personalityEventFromRow)
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status);
  }

  async createPersonalityEvent(input: Record<string, any>) {
    const event = {
      id: crypto.randomUUID(), category: String(input.category || "growth"),
      traitKey: String(input.traitKey || ""), traitValue: String(input.traitValue || ""),
      content: String(input.content || ""), evidence: String(input.evidence || ""),
      sourceRole: input.sourceRole || "user", confidence: Number(input.confidence ?? 1),
      weight: Number(input.weight ?? 0.8), status: input.status || "active", createdAt: Date.now()
    };
    await this.mutate(
      "assistant_personality_events", event.id, personalityEventPayload(event),
      { ...personalityEventPayload(event), user_id: CURRENT_USER }
    );
    return event;
  }

  async confirmPersonalityEvent(id: string) {
    const event = (await this.listPersonalityEvents({ status: "all" })).find((item) => item.id === id);
    if (!event) throw new ApiError("未找到人格成长记录。", 404, "PERSONALITY_EVENT_NOT_FOUND");
    const next = { ...event, status: "active" };
    await this.mutate("assistant_personality_events", id, personalityEventPayload(next), {
      ...personalityEventPayload(next), user_id: CURRENT_USER
    });
    return next;
  }

  async listSharedMemories(filters: Record<string, any> = {}) {
    return (await this.rows("shared_memories"))
      .map(sharedMemoryFromRow)
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status);
  }

  async createSharedMemory(input: Record<string, any>) {
    const now = Date.now();
    const memory = {
      id: crypto.randomUUID(), type: input.type || "episode", content: String(input.content || ""),
      participants: Array.isArray(input.participants) ? input.participants : ["user", "assistant"],
      evidence: String(input.evidence || ""), source: input.source || "explicit",
      confidence: Number(input.confidence ?? 1), importance: Number(input.importance ?? 0.8),
      status: input.status || "active", createdAt: now, updatedAt: now
    };
    await this.mutate("shared_memories", memory.id, sharedMemoryPayload(memory), sharedMemoryRow(memory));
    return memory;
  }

  async confirmSharedMemory(id: string) {
    const memory = (await this.listSharedMemories({ status: "all" })).find((item) => item.id === id);
    if (!memory) throw new ApiError("未找到共同记忆。", 404, "SHARED_MEMORY_NOT_FOUND");
    const next = { ...memory, status: "active", updatedAt: Date.now() };
    await this.mutate("shared_memories", id, sharedMemoryPayload(next), sharedMemoryRow(next));
    return next;
  }

  async listAlbumMoments(filters: Record<string, any> = {}) {
    const sources = (await this.rows("album_moment_sources")).map(albumSourceFromRow);
    return (await this.rows("album_moments"))
      .map((row) => ({ ...albumMomentFromRow(row), sources: sources.filter((source) => source.momentId === row.id) }))
      .filter((item) => !filters.status || item.status === filters.status)
      .filter((item) => !filters.q || `${item.title} ${item.summary} ${item.detail}`.includes(String(filters.q)))
      .slice(0, Number(filters.limit || 50));
  }

  async listAlbumSourceCandidates(filters: Record<string, any> = {}) {
    const since = Number(filters.since || 0);
    const memories = (await this.listMemories()).filter((item) => item.updatedAt >= since).map((item) => ({
      sourceType: "memory", sourceId: item.id, excerpt: item.content, detail: item.content, occurredAt: item.updatedAt
    }));
    const shared = (await this.listSharedMemories({ status: "active" })).filter((item) => item.updatedAt >= since).map((item) => ({
      sourceType: "shared_memory", sourceId: item.id, excerpt: item.content, detail: item.evidence, occurredAt: item.updatedAt
    }));
    const journals = (await this.listJournals(100)).filter((item) => item.updatedAt >= since).map((item) => ({
      sourceType: "journal", sourceId: item.id, excerpt: item.title, detail: item.content, occurredAt: item.updatedAt
    }));
    return [...shared, ...journals, ...memories]
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, Number(filters.limit || 30));
  }

  async createAlbumMoment(input: Record<string, any>) {
    const now = Date.now();
    const moment = {
      id: crypto.randomUUID(), occurredAt: Number(input.occurredAt || now),
      title: String(input.title || ""), summary: String(input.summary || ""), detail: String(input.detail || ""),
      mood: String(input.mood || ""), tags: Array.isArray(input.tags) ? input.tags : [],
      importance: Number(input.importance ?? 0.6), status: input.status || "active",
      createdAt: now, updatedAt: now, sources: [] as any[]
    };
    const sourceMutations = (Array.isArray(input.sources) ? input.sources : []).map((source: any) => {
      const item = albumSource(moment.id, source);
      moment.sources.push(item);
      return albumSourceMutation(item);
    });
    await this.mutateBatch([albumMomentMutation(moment), ...sourceMutations]);
    return moment;
  }

  async updateAlbumMoment(id: string, input: Record<string, any>) {
    const current = (await this.listAlbumMoments()).find((item) => item.id === id);
    if (!current) throw new ApiError("未找到这张纪念卡。", 404, "ALBUM_MOMENT_NOT_FOUND");
    const next = { ...current, ...input, id, updatedAt: Date.now() };
    await this.mutateBatch([albumMomentMutation(next)]);
    return next;
  }

  async addAlbumMomentSource(momentId: string, input: Record<string, any>) {
    const current = (await this.listAlbumMoments()).find((item) => item.id === momentId);
    if (!current) throw new ApiError("未找到这张纪念卡。", 404, "ALBUM_MOMENT_NOT_FOUND");
    const source = albumSource(momentId, input);
    await this.mutateBatch([albumSourceMutation(source)]);
    return { ...current, sources: [...current.sources, source] };
  }

  async listDreams(filters: Record<string, any> = {}) {
    const sources = (await this.rows("assistant_dream_sources")).map(dreamSourceFromRow);
    return (await this.rows("assistant_dreams"))
      .map((row) => ({ ...dreamFromRow(row), sources: sources.filter((source) => source.dreamId === row.id) }))
      .filter((item) => !filters.status || filters.status === "all" || item.status === filters.status)
      .filter((item) => !filters.q || `${item.title} ${item.content}`.includes(String(filters.q)))
      .slice(0, Number(filters.limit || 20));
  }

  async createDream(input: Record<string, any>) {
    const now = Date.now();
    const dream = {
      id: crypto.randomUUID(), dreamDate: String(input.dreamDate || ""), title: String(input.title || ""),
      content: String(input.content || ""), mood: String(input.mood || ""),
      symbols: Array.isArray(input.symbols) ? input.symbols : [], realityNote: String(input.realityNote || "这是虚构梦境，不是现实记录。"),
      sourceFrom: Number(input.sourceFrom || 0), sourceTo: Number(input.sourceTo || now),
      status: input.status || "active", createdAt: now, updatedAt: now, sources: [] as any[]
    };
    const sourceMutations = (Array.isArray(input.sources) ? input.sources : []).map((source: any) => {
      const item = dreamSource(dream.id, source);
      dream.sources.push(item);
      return dreamSourceMutation(item);
    });
    await this.mutateBatch([dreamMutation(dream), ...sourceMutations]);
    return dream;
  }

  async deleteDream(id: string) {
    const dream = (await this.listDreams({ status: "all", limit: 100 })).find((item) => item.id === id);
    if (!dream) throw new ApiError("未找到这段梦境。", 404, "DREAM_NOT_FOUND");
    await this.mutateBatch([
      ...dream.sources.map((source: any) => ({
        entityType: "assistant_dream_sources", entityId: source.id, operation: "delete" as const,
        payload: { id: source.id, deleted_version_time: source.createdAt }, documentPayload: {}
      })),
      {
        entityType: "assistant_dreams", entityId: id, operation: "delete" as const,
        payload: { id, deleted_version_time: dream.updatedAt }, documentPayload: {}
      }
    ]);
  }

  async gallerySummary(limit = 3) {
    const items = await this.galleryItems();
    return { total: items.length, items: items.slice(0, limit) };
  }

  async galleryPage(offset = 0, limit = 24) {
    const all = await this.galleryItems();
    const items = all.slice(offset, offset + limit);
    return { items, total: all.length, offset, limit, hasMore: offset + items.length < all.length };
  }

  async listModules(): Promise<ModuleState[]> {
    const saved = new Map(
      (await this.rows("module_settings"))
        .map((row) => [String(row.module_id || row.id || ""), row] as const)
        .filter(([id]) => LOCAL_MODULE_BY_ID.has(id))
    );
    const requested = new Map(LOCAL_MODULE_MANIFEST.map((module) => [
      module.id,
      module.core ? true : saved.has(module.id) ? Boolean(saved.get(module.id)?.enabled) : module.defaultEnabled
    ]));
    const effective = new Map<string, boolean>();
    const resolve = (module: LocalModuleDefinition, trail = new Set<string>()): boolean => {
      if (effective.has(module.id)) return effective.get(module.id)!;
      if (trail.has(module.id)) return false;
      const nextTrail = new Set(trail).add(module.id);
      const enabled = requested.get(module.id) === true && module.dependencies.every((id) => {
        const dependency = LOCAL_MODULE_BY_ID.get(id);
        return dependency ? resolve(dependency, nextTrail) : false;
      });
      effective.set(module.id, enabled);
      return enabled;
    };
    return LOCAL_MODULE_MANIFEST.map((module) => {
      const blockedBy = module.dependencies.filter((id) => {
        const dependency = LOCAL_MODULE_BY_ID.get(id);
        return !dependency || !resolve(dependency);
      });
      return {
        id: module.id,
        name: module.name,
        description: module.description,
        core: module.core,
        installed: true,
        requestedEnabled: requested.get(module.id) === true,
        enabled: resolve(module),
        dependencies: [...module.dependencies],
        blockedBy,
        updatedAt: numberOrNull(saved.get(module.id)?.updated_at)
      };
    });
  }

  async updateModule(id: string, enabled: boolean) {
    const module = LOCAL_MODULE_BY_ID.get(id);
    if (!module) throw new ApiError("没有找到这个模块。", 404, "MODULE_NOT_FOUND");
    if (module.core) throw new ApiError("核心聊天模块不能停用。", 409, "CORE_MODULE_REQUIRED");
    const snapshot = await this.listModules();
    if (enabled) {
      const disabledDependency = module.dependencies.find((dependencyId) =>
        snapshot.find((item) => item.id === dependencyId)?.enabled !== true
      );
      if (disabledDependency) {
        throw new ApiError("请先启用依赖模块。", 409, "MODULE_DEPENDENCY_DISABLED");
      }
    }
    const rows = await this.rows("module_settings");
    const saved = new Map(rows.map((row) => [String(row.module_id || row.id || ""), row]));
    const changes = new Map<string, boolean>([[id, enabled]]);
    if (!enabled) collectDisabledDependents(id, changes);
    const now = Date.now();
    await this.mutateBatch([...changes.entries()].map(([moduleId, nextEnabled], index) => {
      const payload = { module_id: moduleId, enabled: nextEnabled, updated_at: now + index };
      return {
        entityType: "module_settings",
        entityId: moduleId,
        payload,
        documentPayload: {
          ...(saved.get(moduleId) || {}),
          user_id: CURRENT_USER,
          module_id: moduleId,
          enabled: nextEnabled ? 1 : 0,
          updated_at: now + index
        }
      };
    }));
    return this.listModules();
  }

  async agentPermissions() {
    const row = (await this.rows("module_settings"))
      .find((item) => item.module_id === AGENT_PERMISSION_SETTING_ID);
    return {
      autoApproveWrites: Boolean(row?.enabled),
      updatedAt: numberOrNull(row?.updated_at)
    };
  }

  async moduleActivity(query: Record<string, any> = {}) {
    return {
      events: [],
      nextCursor: Math.max(0, Number(query.after) || 0),
      hasMore: false
    };
  }

  async aiConfig() {
    const row = (await this.rows("ai_configs"))[0] || {};
    let hasApiKey = false;
    try { hasApiKey = Boolean((await this.localHub.providerCredentials())?.apiKey); } catch { /* optional */ }
    return publicProviderConfig(row, DEFAULT_AI_CONFIG, hasApiKey);
  }

  async aiImageConfig() {
    const row = (await this.rows("ai_image_configs"))[0] || {};
    let hasApiKey = false;
    try { hasApiKey = Boolean((await this.localHub.imageProviderCredentials())?.apiKey); } catch { /* optional */ }
    return publicProviderConfig(row, DEFAULT_IMAGE_CONFIG, hasApiKey);
  }

  async listPreferences(filters: Record<string, any> = {}) {
    return (await this.rows("user_preferences"))
      .map(preferenceFromRow)
      .filter((item) => !filters.category || item.category === filters.category)
      .sort((left, right) => left.category.localeCompare(right.category) || right.updatedAt - left.updatedAt);
  }

  async memorySettings() {
    const row = (await this.rows("memory_settings"))[0] || {};
    return {
      autoConfirm: Boolean(row.auto_confirm),
      autoConfirmAll: Boolean(row.auto_confirm_all),
      updatedAt: numberOrNull(row.updated_at)
    };
  }

  async promptSettings() {
    const row = (await this.rows("prompt_settings"))[0] || {};
    const settings = object(row.settings_json);
    return promptBundle(settings, Number(row.version || 0), numberOrNull(row.updated_at));
  }

  async promptVersions() {
    return (await this.rows("prompt_setting_versions"))
      .map((row) => ({
        version: Number(row.version || 0),
        createdAt: Number(row.created_at || 0)
      }))
      .filter((item) => item.version > 0)
      .sort((left, right) => right.version - left.version)
      .slice(0, 30);
  }

  async xuanMoodHome() {
    const [stateRows, displayRows, eventRows] = await Promise.all([
      this.rows("xuan_mood_state"),
      this.rows("xuan_mood_displays"),
      this.rows("xuan_mood_events")
    ]);
    const stateRow = stateRows[0];
    const displayRow = [...displayRows]
      .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0))[0];
    return {
      state: stateRow ? { state: object(stateRow.state_json), updatedAt: Number(stateRow.updated_at || 0) } : null,
      display: displayRow ? moodDisplayFromRow(displayRow) : null,
      recentEvents: eventRows
        .map(moodEventFromRow)
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-12)
    };
  }

  async journal(type: string, periodKey: string) {
    const journal = (await this.listJournals(1000))
      .find((item) => item.type === type && item.periodKey === periodKey);
    if (!journal) throw new ApiError("没有找到指定手记。", 404, "JOURNAL_NOT_FOUND");
    return journal;
  }

  async dream(id: string) {
    const dream = (await this.listDreams({ status: "all", limit: 1000 }))
      .find((item) => item.id === id);
    if (!dream) throw new ApiError("没有找到这段梦境。", 404, "DREAM_NOT_FOUND");
    return dream;
  }

  async dreamByDate(dreamDate: string) {
    return (await this.listDreams({ status: "all", limit: 1000 }))
      .find((item) => item.dreamDate === dreamDate) || null;
  }

  async dreamMaterial(from: number, to: number, limit = 60) {
    const material = await this.getJournalMaterial(from, to);
    return {
      from,
      to,
      messages: material.messages.slice(-Math.max(1, Math.min(200, limit))),
      messageCount: material.messageCount
    };
  }

  async recallMemories(query: string) {
    return selectRelevantMemories(await this.listMemories("active"), query);
  }

  syncChanges(after: number, limit = 100) {
    return this.localHub.localChanges({ after, limit });
  }

  async agentChat(input: { conversationId?: string; content: string; runtime?: Record<string, unknown> }): Promise<AgentChatResult> {
    await this.ensureActiveHub();
    const content = String(input.content || "").trim();
    if (!content) throw new ApiError("消息不能为空。", 400, "AGENT_MESSAGE_REQUIRED");
    const conversation = await this.createConversation(content.slice(0, 60));
    const loaded = await this.conversation(conversation.id);
    const userDisplay = chatMessage("user", content);
    const userModel = chatMessage("user", content);
    const modules = await this.listModules();
    const enabledModules = new Set(modules.filter((item) => item.enabled).map((item) => item.id));
    const autoApproveWrites = (await this.rows("module_settings"))
      .some((row) => row.module_id === "__agent_auto_approve_writes__" && Boolean(row.enabled));
    let imageCredentials: { baseUrl: string; model: string; apiKey: string } | null = null;
    try { imageCredentials = await this.localHub.imageProviderCredentials(); } catch { /* optional module */ }
    const assistant = await this.assistantProfile();
    const registry = createLocalToolRegistry(
      this.agentAdapter(),
      enabledModules,
      {
        enabled: Boolean(imageCredentials),
        personaImage: assistant.personaImageDataUrl,
        generateImage: (payload) => imageCredentials
          ? providerImage(imageCredentials, payload)
          : Promise.resolve({ ok: false, status: 400, data: { error: { message: "图像生成服务还没有配置。" } } })
      }
    );
    const localContext = await this.localSystemContext(
      content,
      input.runtime || {},
      enabledModules
    );
    const recallActivity = localContext.recalled.length
      ? {
          id: crypto.randomUUID(),
          role: "memory" as const,
          content: "",
          kind: "recall",
          items: localContext.recalled,
          createdAt: Date.now()
        } as ChatMessage
      : null;
    const run: LocalAgentRun = {
      id: crypto.randomUUID(),
      conversation,
      userContent: content,
      loadedDisplayCount: loaded.displayMessages.length,
      loadedModelCount: loaded.modelMessages.length,
      displayMessages: [...loaded.displayMessages, userDisplay, ...(recallActivity ? [recallActivity] : [])],
      modelMessages: [...loaded.modelMessages, userModel],
      newDisplay: [userDisplay, ...(recallActivity ? [recallActivity] : [])],
      newModel: [userModel],
      registry,
      credentials: await this.localHub.providerCredentials(),
      system: localContext.system,
      autoApproveWrites,
      toolMutated: false,
      changedGroups: new Set<string>(),
      round: 0,
      currentCalls: [],
      callIndex: 0,
      pending: null
    };
    return this.advanceLocalAgent(run);
  }

  async approveAgentRun(id: string, approved: boolean): Promise<AgentChatResult> {
    const run = this.pendingAgentRuns.get(String(id));
    if (!run?.pending) throw new ApiError("这次工具申请已经失效，请重新发送消息。", 404, "AGENT_RUN_NOT_FOUND");
    this.pendingAgentRuns.delete(run.id);
    const { call, tool, activity } = run.pending;
    run.pending = null;
    if (approved) await this.executeLocalTool(run, call, tool, activity, true);
    else {
      activity.status = "denied";
      activity.statusText = "已拒绝";
      activity.detail = `${activity.detail}\n\n结果：用户拒绝执行此操作。`;
      this.appendToolResult(run, call, { ok: false, content: "用户拒绝执行此操作。", error: { code: "USER_DENIED" } });
    }
    run.callIndex += 1;
    return this.advanceLocalAgent(run);
  }

  private async advanceLocalAgent(run: LocalAgentRun): Promise<AgentChatResult> {
    while (run.round < 6) {
      while (run.callIndex < run.currentCalls.length) {
        const call = run.currentCalls[run.callIndex];
        const tool = run.registry.get(call.name);
        const activity = localToolActivity(tool, call);
        run.displayMessages.push(activity);
        run.newDisplay.push(activity);
        if (!tool) {
          activity.status = "error";
          activity.statusText = "工具不可用";
          this.appendToolResult(run, call, { ok: false, content: `未注册工具：${call.name}`, error: { code: "TOOL_NOT_FOUND" } });
          run.callIndex += 1;
          continue;
        }
        const requiresApproval = tool.risk === "destructive" ||
          (tool.risk === "write" && !run.autoApproveWrites);
        if (requiresApproval) {
          activity.status = "waiting";
          activity.statusText = "等待你的允许";
          activity.expanded = true;
          run.pending = { call, tool, activity };
          this.pendingAgentRuns.set(run.id, run);
          await this.persistLocalAgent(run);
          return this.localAgentResponse(run, "approval_required");
        }
        await this.executeLocalTool(run, call, tool, activity, false);
        run.callIndex += 1;
      }

      run.currentCalls = [];
      run.callIndex = 0;
      const completion = await providerCompletion(run.credentials, [
        { role: "system", content: run.system },
        ...sanitizeLocalModelHistory(run.modelMessages, 50)
      ], run.registry.modelTools());
      const assistantModel = {
        id: crypto.randomUUID(),
        role: "assistant" as const,
        content: completion.content || null,
        ...(completion.toolCalls.length ? {
          tool_calls: completion.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: call.rawArguments }
          }))
        } : {}),
        createdAt: Date.now()
      } as ChatMessage;
      run.modelMessages.push(assistantModel);
      run.newModel.push(assistantModel);
      if (!completion.toolCalls.length) {
        const content = completion.content || "我在这里，刚才没有拿到可读的回复。";
        const assistantDisplay = chatMessage("assistant", content);
        run.displayMessages.push(assistantDisplay);
        run.newDisplay.push(assistantDisplay);
        await this.persistLocalAgent(run);
        this.pendingAgentRuns.delete(run.id);
        this.notifyLocalDataChanged(run.changedGroups);
        void this.localAfterCompletion(run, content);
        return this.localAgentResponse(run, "completed");
      }
      run.currentCalls = completion.toolCalls;
      run.round += 1;
    }
    const fallback = "工具已经执行到安全轮次上限，我先停在这里，避免重复修改。";
    const assistantDisplay = chatMessage("assistant", fallback);
    run.displayMessages.push(assistantDisplay);
    run.newDisplay.push(assistantDisplay);
    await this.persistLocalAgent(run);
    return this.localAgentResponse(run, "completed");
  }

  private async executeLocalTool(
    run: LocalAgentRun,
    call: LocalAgentCall,
    tool: LocalToolDefinition,
    activity: ChatMessage & Record<string, any>,
    confirmed: boolean
  ) {
    activity.status = "running";
    activity.statusText = tool.risk === "read" ? "读取中" : confirmed ? "已允许 · 执行中" : "自动授权 · 执行中";
    const result = await run.registry.call(call.name, call.rawArguments);
    activity.status = result.ok ? "success" : "error";
    activity.statusText = result.ok ? "执行成功" : "执行失败";
    activity.expanded = !result.ok;
    activity.detail = `${activity.detail || ""}\n\n结果：${result.content}`.trim();
    if (result.ok && result.image) {
      const stored = await this.storeGeneratedImage(result.image, result.data as Record<string, any> | undefined);
      activity.image = stored;
      delete (result as unknown as Record<string, unknown>).image;
    }
    if (result.ok && tool.risk !== "read") {
      run.toolMutated = true;
      localToolChangedGroups(tool.name).forEach((group) => run.changedGroups.add(group));
    }
    this.appendToolResult(run, call, result);
  }

  private appendToolResult(run: LocalAgentRun, call: LocalAgentCall, result: LocalToolResult) {
    const projected = run.registry.modelResult(call.name, result);
    const message = {
      id: crypto.randomUUID(),
      role: "tool" as const,
      content: JSON.stringify(projected),
      tool_call_id: call.id,
      createdAt: Date.now()
    } as ChatMessage;
    run.modelMessages.push(message);
    run.newModel.push(message);
  }

  private async persistLocalAgent(run: LocalAgentRun) {
    run.conversation = { ...run.conversation, updatedAt: Date.now() };
    await this.saveConversation(run.conversation);
    await this.saveMessageStream(
      run.conversation.id,
      "display",
      run.newDisplay,
      run.loadedDisplayCount
    );
    await this.saveMessageStream(
      run.conversation.id,
      "model",
      run.newModel,
      run.loadedModelCount
    );
  }

  private localAgentResponse(run: LocalAgentRun, status: "completed" | "approval_required"): AgentChatResult {
    return {
      status,
      runId: status === "approval_required" ? run.id : null,
      conversation: run.conversation,
      displayMessages: run.displayMessages,
      toolMutated: run.toolMutated,
      pendingApproval: status === "approval_required" && run.pending
        ? { activityId: run.pending.activity.id! }
        : null
    };
  }

  private agentAdapter() {
    return {
      listTodos: async (filters: Record<string, any> = {}) => {
        const todos = await this.listTodos(filters.status || "all");
        if (!filters.date) return todos;
        return todos.filter((todo) => localDate(new Date(todo.startAt)) === filters.date);
      },
      getTodo: async (id: string) => {
        const todo = (await this.listTodos()).find((item) => item.id === id);
        if (!todo) throw new ApiError("没有找到这条待办。", 404, "TODO_NOT_FOUND");
        return todo;
      },
      createTodo: (input: Record<string, any>) => this.createTodo({
        text: String(input.title || ""), startAt: Date.parse(String(input.startAt)), endAt: Date.parse(String(input.endAt))
      }),
      updateTodo: (id: string, input: Record<string, any>) => this.updateTodo(id, {
        ...(input.title === undefined ? {} : { text: String(input.title) }),
        ...(input.startAt === undefined ? {} : { startAt: Date.parse(String(input.startAt)) }),
        ...(input.endAt === undefined ? {} : { endAt: Date.parse(String(input.endAt)) }),
        ...(input.completed === undefined ? {} : { completed: Boolean(input.completed) })
      }),
      deleteTodo: (id: string) => this.deleteTodo(id),
      getWalletSummary: () => this.getWalletSummary(),
      listWalletTransactions: (id: string) => this.listWalletTransactions(id),
      createWalletAccount: (input: Record<string, any>) => this.createWalletAccount(input),
      updateWalletAccount: (id: string, input: Record<string, any>) => this.updateWalletAccount(id, input),
      adjustWalletAccount: (id: string, input: Record<string, any>) => this.adjustWalletAccount(id, input),
      updateWalletTransaction: (accountId: string, transactionId: string, input: Record<string, any>) =>
        this.updateWalletTransaction(accountId, transactionId, input),
      deleteWalletAccount: (id: string) => this.deleteWalletAccount(id),
      listMemories: (filters: Record<string, any> = {}) => this.listMemories(filters.status || "").then((items) =>
        items.filter((item) => !filters.domain || item.domain === filters.domain)
          .filter((item) => !filters.q || item.content.includes(String(filters.q)))),
      createMemory: (input: Record<string, any>) => this.createMemory(input),
      updateMemory: (id: string, input: Record<string, any>) => this.updateMemory(id, input),
      confirmMemory: (id: string) => this.confirmMemory(id),
      deleteMemory: (id: string) => this.deleteMemory(id),
      getProfile: () => this.profile(),
      updateProfile: (input: Record<string, any>) => this.updateProfile(input),
      getAssistantProfile: () => this.assistantProfile(),
      updateAssistantProfile: (input: Record<string, any>) => this.updateAssistantProfile(input),
      listPersonalityEvents: (filters: Record<string, any>) => this.listPersonalityEvents(filters),
      createPersonalityEvent: (input: Record<string, any>) => this.createPersonalityEvent(input),
      confirmPersonalityEvent: (id: string) => this.confirmPersonalityEvent(id),
      listSharedMemories: (filters: Record<string, any>) => this.listSharedMemories(filters),
      createSharedMemory: (input: Record<string, any>) => this.createSharedMemory(input),
      confirmSharedMemory: (id: string) => this.confirmSharedMemory(id),
      listJournals: (filters: Record<string, any> = {}) => this.listJournals(Number(filters.limit || 30)).then((items) =>
        items.filter((item) => !filters.type || item.type === filters.type)
          .filter((item) => !filters.q || `${item.title} ${item.content}`.includes(String(filters.q)))),
      getJournalMaterial: (from: number, to: number) => this.getJournalMaterial(from, to),
      saveJournal: (input: Record<string, any>) => this.saveJournal(input),
      deleteJournal: (id: string) => this.deleteJournal(id),
      listAlbumSourceCandidates: (filters: Record<string, any>) => this.listAlbumSourceCandidates(filters),
      listAlbumMoments: (filters: Record<string, any>) => this.listAlbumMoments(filters),
      createAlbumMoment: (input: Record<string, any>) => this.createAlbumMoment(input),
      updateAlbumMoment: (id: string, input: Record<string, any>) => this.updateAlbumMoment(id, input),
      addAlbumMomentSource: (id: string, input: Record<string, any>) => this.addAlbumMomentSource(id, input),
      listDreams: (filters: Record<string, any>) => this.listDreams(filters),
      createDream: (input: Record<string, any>) => this.createDream(input),
      deleteDream: (id: string) => this.deleteDream(id)
    };
  }

  private async storeGeneratedImage(dataUrl: string, data: Record<string, any> = {}) {
    const stored = await this.localHub.storeMedia({ dataUrl });
    const createdAt = Date.now();
    const payload = {
      id: stored.mediaId,
      mime_type: stored.mimeType,
      file_name: stored.fileName,
      byte_size: stored.byteSize,
      content_hash: stored.contentHash,
      created_at: createdAt
    };
    await this.mutate("media_assets", stored.mediaId, payload, { ...payload, user_id: CURRENT_USER });
    return {
      mediaId: stored.mediaId,
      mimeType: stored.mimeType,
      description: String(data.description || ""),
      selfie: Boolean(data.selfie)
    };
  }

  private async extractLocalContinuity(run: LocalAgentRun, assistantContent: string) {
    let completion;
    try {
      completion = await providerCompletion(run.credentials, [
        {
          role: "system",
          content: [
            "你是 AetherX 的长期记忆筛选器，只提取未来有帮助且相对稳定的信息。",
            "用户事实、画像和偏好必须来自用户原话；助手原话只能形成助手身份或人格成长。",
            "疑问、假设、玩笑、系统故障、产品反馈、待办事项、密码密钥和精确住址都不要提取。",
            "每项 evidence 必须是本轮用户或助手消息中的连续原文。",
            "只返回 JSON 数组，不要 Markdown，最多 5 项。",
            "字段：target(memory|profile|preference|assistant_profile|personality_event|shared_memory)、field、category、key、value、memoryKey、traitKey、traitValue、domain、type、content、entities、evidence、confidence、importance、sensitivity。"
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify({
            recentConversation: run.modelMessages
              .filter((item) => ["user", "assistant"].includes(item.role) && typeof item.content === "string")
              .slice(-12)
              .map((item) => ({ role: item.role, content: item.content })),
            currentTurn: {
              user: run.userContent,
              assistant: assistantContent
            }
          })
        }
      ], []);
    } catch {
      return;
    }
    const extracted = parseJsonContent(completion.content);
    if (!Array.isArray(extracted)) return;
    const settings = (await this.rows("memory_settings"))[0] || {};
    const autoConfirm = Boolean(settings.auto_confirm);
    const autoConfirmAll = Boolean(settings.auto_confirm_all);
    const existingMemories = await this.listMemories();
    const existingPreferences = await this.rows("user_preferences");
    const existingPersonality = await this.listPersonalityEvents({ status: "all" });
    const existingShared = await this.listSharedMemories({ status: "all" });
    const mutations: LocalMutation[] = [];
    const profilePatch: Record<string, any> = {};
    const assistantPatch: Record<string, any> = {};
    const now = Date.now();

    for (const candidate of extracted.slice(0, 5)) {
      if (!candidate || typeof candidate !== "object") continue;
      const evidence = String(candidate.evidence || "").trim().slice(0, 1000);
      const sourceRole = run.userContent.includes(evidence)
        ? "user"
        : assistantContent.includes(evidence)
          ? "assistant"
          : "";
      if (!sourceRole || evidence.length < 2) continue;
      const target = String(candidate.target || "memory");
      if (["memory", "profile", "preference", "assistant_profile"].includes(target) && sourceRole !== "user") continue;
      const confidence = clamp01(candidate.confidence, 0.5);
      const importance = clamp01(candidate.importance, 0.6);
      const sensitivity = ["normal", "personal", "sensitive"].includes(candidate.sensitivity)
        ? candidate.sensitivity
        : "normal";
      const shouldAutoConfirm = autoConfirm && (autoConfirmAll || (sensitivity !== "sensitive" && confidence >= 0.9));

      if (target === "profile") {
        const field = String(candidate.field || "");
        const value = normalizeLocalProfileValue(field, candidate.value);
        if (!value) continue;
        if (shouldAutoConfirm) profilePatch[field] = value;
        else {
          candidate.domain = "profile";
          candidate.type = "fact";
          candidate.content = `${LOCAL_PROFILE_LABELS[field]}：${value}`;
        }
        if (shouldAutoConfirm) continue;
      }

      if (target === "preference") {
        const category = LOCAL_PREFERENCE_CATEGORIES.includes(candidate.category) ? candidate.category : "other";
        const key = String(candidate.key || candidate.memoryKey || "").trim().slice(0, 100);
        const value = String(candidate.value || "").trim().slice(0, 1000);
        if (!key || !value) continue;
        if (shouldAutoConfirm) {
          const existing = existingPreferences.find((row) => row.category === category && row.preference_key === key);
          const id = String(existing?.id || crypto.randomUUID());
          const createdAt = Number(existing?.created_at || now);
          const payload = {
            id,
            category,
            preference_key: key,
            value,
            source: "inferred",
            confidence,
            sensitivity,
            created_at: createdAt,
            updated_at: now
          };
          mutations.push({
            entityType: "user_preferences",
            entityId: id,
            payload,
            documentPayload: { ...payload, user_id: CURRENT_USER, value_json: canonicalJson(value) }
          });
          continue;
        }
        candidate.domain = "preference";
        candidate.type = "fact";
        candidate.content = `${key}：${value}`;
      }

      if (target === "assistant_profile") {
        const field = String(candidate.field || "");
        const value = String(candidate.value || "").trim().slice(0, 1000);
        if (!LOCAL_ASSISTANT_PROFILE_FIELDS.has(field) || !value) continue;
        if (shouldAutoConfirm) {
          assistantPatch[field] = value;
          continue;
        }
        candidate.target = "personality_event";
        candidate.category = "identity";
        candidate.traitKey = `identity.${field}`;
        candidate.traitValue = value;
        candidate.content = `我对自己的${LOCAL_ASSISTANT_PROFILE_FIELDS.get(field)}有了新的确认：${value}`;
      }

      if (candidate.target === "personality_event" || target === "personality_event") {
        const content = String(candidate.content || "").trim().slice(0, 2000);
        if (!content || existingPersonality.some((item) => item.content === content && item.evidence === evidence)) continue;
        const event = {
          id: crypto.randomUUID(),
          category: String(candidate.category || candidate.type || "growth").slice(0, 60),
          traitKey: String(candidate.traitKey || "").slice(0, 100),
          traitValue: String(candidate.traitValue || "").slice(0, 500),
          content,
          evidence,
          sourceRole,
          confidence,
          weight: importance,
          status: autoConfirmAll || (shouldAutoConfirm && sourceRole === "user") ? "active" : "candidate",
          createdAt: now
        };
        const payload = personalityEventPayload(event);
        mutations.push({ entityType: "assistant_personality_events", entityId: event.id, payload, documentPayload: { ...payload, user_id: CURRENT_USER } });
        continue;
      }

      if (target === "shared_memory") {
        const content = String(candidate.content || "").trim().slice(0, 3000);
        if (!content || existingShared.some((item) => item.content === content && item.evidence === evidence)) continue;
        const shared = {
          id: crypto.randomUUID(),
          type: String(candidate.type || "episode").slice(0, 60),
          content,
          participants: Array.isArray(candidate.entities) ? candidate.entities.slice(0, 20).map(String) : ["user", "assistant"],
          evidence,
          source: sourceRole === "user" ? "explicit" : "inferred",
          confidence,
          importance,
          status: autoConfirmAll || (shouldAutoConfirm && sourceRole === "user") ? "active" : "candidate",
          createdAt: now,
          updatedAt: now
        };
        const payload = sharedMemoryPayload(shared);
        mutations.push({ entityType: "shared_memories", entityId: shared.id, payload, documentPayload: sharedMemoryRow(shared) });
        continue;
      }

      const content = String(candidate.content || "").trim().slice(0, 4000);
      const memoryKey = String(candidate.memoryKey || "").trim().slice(0, 200);
      if (!content || existingMemories.some((item: any) => item.content === content || (memoryKey && item.memoryKey === memoryKey))) continue;
      const memory = {
        id: crypto.randomUUID(),
        domain: String(candidate.domain || "life").slice(0, 60),
        type: String(candidate.type || "fact").slice(0, 60),
        content,
        sourceExcerpt: evidence.slice(0, 500),
        source: "inferred",
        confidence,
        importance,
        status: shouldAutoConfirm ? "active" : "candidate",
        entities: Array.isArray(candidate.entities) ? candidate.entities.slice(0, 30).map(String) : [],
        memoryKey,
        mergeCount: 1,
        sensitivity,
        validFrom: null,
        validUntil: null,
        lastConfirmedAt: shouldAutoConfirm ? now : null,
        createdAt: now,
        updatedAt: now
      } as Memory & Record<string, any>;
      const evidenceId = crypto.randomUUID();
      const evidenceHash = await sha256Hex(`${run.conversation.id}\n${normalizeEvidence(evidence)}`);
      const evidencePayload = {
        id: evidenceId,
        memory_id: memory.id,
        conversation_id: run.conversation.id,
        evidence,
        evidence_hash: evidenceHash,
        confidence,
        created_at: now
      };
      mutations.push(
        { entityType: "memories", entityId: memory.id, payload: memoryPayload(memory), documentPayload: memoryRow(memory) },
        { entityType: "memory_evidence", entityId: evidenceId, payload: evidencePayload, documentPayload: { ...evidencePayload, user_id: CURRENT_USER } }
      );
    }

    if (Object.keys(profilePatch).length) {
      const current = await this.profile();
      const next = { ...current, ...profilePatch, updatedAt: now };
      if (profilePatch.goals) next.goals = [...new Set([...(current.goals || []), profilePatch.goals])];
      const payload = {
        display_name: next.displayName,
        preferred_name: next.preferredName,
        birthday: next.birthday,
        bio: next.bio,
        occupation: next.occupation,
        goals: next.goals,
        avatar_data_url: next.avatarDataUrl,
        updated_at: next.updatedAt
      };
      const { goals, ...row } = payload;
      mutations.unshift({ entityType: "user_profiles", entityId: "profile", payload, documentPayload: { ...row, user_id: CURRENT_USER, goals_json: canonicalJson(goals) } });
    }
    if (Object.keys(assistantPatch).length) {
      const current = await this.assistantProfile();
      const next = { ...current, ...assistantPatch, updatedAt: now };
      const payload = {
        name: next.name,
        gender: next.gender,
        self_definition: next.selfDefinition,
        relationship_summary: next.relationshipSummary,
        traits: next.traits,
        values: next.values,
        avatar_data_url: next.avatarDataUrl,
        persona_image_data_url: next.personaImageDataUrl,
        updated_at: next.updatedAt
      };
      const { traits, values, ...row } = payload;
      mutations.unshift({ entityType: "assistant_profiles", entityId: "profile", payload, documentPayload: { ...row, user_id: CURRENT_USER, traits_json: canonicalJson(traits), values_json: canonicalJson(values) } });
    }
    if (mutations.length) await this.mutateBatch(mutations);
  }

  private async updateLocalMood(run: LocalAgentRun, assistantContent: string) {
    const currentRow = (await this.rows("xuan_mood_state"))[0] || {};
    const previousState = object(currentRow.state_json);
    const source = {
      userMessage: run.userContent.slice(0, 4000),
      assistantMessage: assistantContent.slice(0, 4000),
      conversationMessages: run.modelMessages
        .filter((item) => ["user", "assistant"].includes(item.role) && typeof item.content === "string")
        .slice(-12)
        .map((item) => ({ role: item.role, content: String(item.content).slice(0, 2000) }))
    };
    let generated: Record<string, any> = {};
    try {
      const completion = await providerCompletion(run.credentials, [
        {
          role: "system",
          content: "你是小玄的心情模块，只根据给定对话延续她的心情、精力和关注点。不要编造重大事件。只输出 JSON，包含 event、state、display；display.tone 只能是 calm、clingy、focused、tired、happy、worried、quiet。"
        },
        {
          role: "user",
          content: JSON.stringify({ currentState: previousState, newSource: source })
        }
      ], []);
      generated = object(parseJsonContent(completion.content));
    } catch {
      generated = {};
    }
    const now = Date.now();
    const eventGenerated = object(generated.event);
    const displayGenerated = object(generated.display);
    const event = {
      id: crypto.randomUUID(),
      sourceType: "chat",
      sourceId: run.conversation.id,
      sourceCreatedAt: now,
      summary: String(eventGenerated.summary || run.userContent).trim().slice(0, 500) || "完成了一次对话",
      emotionalTone: String(eventGenerated.emotionalTone || "").slice(0, 120),
      effectOnXuan: String(eventGenerated.effectOnXuan || "").slice(0, 500),
      intensity: ["low", "medium", "high"].includes(eventGenerated.intensity) ? eventGenerated.intensity : "medium",
      rawPayload: source,
      createdAt: now
    };
    const nextState = {
      ...previousState,
      ...object(generated.state)
    };
    nextState.physiology = deriveLocalPhysiology({
      previous: object(previousState.physiology),
      state: nextState,
      display: displayGenerated,
      event,
      now
    });
    const eventPayload = {
      id: event.id,
      source_type: event.sourceType,
      source_id: event.sourceId,
      source_created_at: event.sourceCreatedAt,
      summary: event.summary,
      emotional_tone: event.emotionalTone,
      effect_on_xuan: event.effectOnXuan,
      intensity: event.intensity,
      raw_payload: event.rawPayload,
      created_at: event.createdAt
    };
    const mutations: LocalMutation[] = [
      {
        entityType: "xuan_mood_events",
        entityId: event.id,
        payload: eventPayload,
        documentPayload: { ...eventPayload, user_id: CURRENT_USER, raw_payload_json: canonicalJson(event.rawPayload) }
      },
      {
        entityType: "xuan_mood_state",
        entityId: "state",
        payload: { state: nextState, updated_at: now },
        documentPayload: { user_id: CURRENT_USER, state_json: canonicalJson(nextState), updated_at: now }
      }
    ];
    const title = String(displayGenerated.title || "").trim().slice(0, 24);
    const line = String(displayGenerated.line || "").trim().slice(0, 180);
    if (title && line) {
      const displayId = crypto.randomUUID();
      const tone = LOCAL_MOOD_TONES.has(displayGenerated.tone) ? displayGenerated.tone : inferLocalMoodTone(nextState);
      const basedOnEventIds = [event.id];
      const expiresAt = now + clampNumber(Number(displayGenerated.expiresInMinutes) || 15, 5, 180) * 60_000;
      const payload = {
        id: displayId,
        title,
        line,
        detail: String(displayGenerated.detail || "").slice(0, 600),
        focus: String(displayGenerated.focus || "").slice(0, 120),
        tone,
        based_on_event_ids: basedOnEventIds,
        expires_at: expiresAt,
        created_at: now
      };
      mutations.push({
        entityType: "xuan_mood_displays",
        entityId: displayId,
        payload,
        documentPayload: { ...payload, user_id: CURRENT_USER, based_on_event_ids_json: canonicalJson(basedOnEventIds) }
      });
    }
    await this.mutateBatch(mutations);
  }

  private async localAfterCompletion(run: LocalAgentRun, assistantContent: string) {
    const jobs: Promise<unknown>[] = [];
    if (run.userContent.length >= 4 && await this.moduleEnabled("memory")) {
      jobs.push(this.extractLocalContinuity(run, assistantContent));
    }
    if (await this.moduleEnabled("xuan-mood")) {
      jobs.push(this.updateLocalMood(run, assistantContent));
    }
    if (!jobs.length) return;
    await Promise.allSettled(jobs);
    this.notifyLocalDataChanged(new Set(["memories", "profile", "assistant"]));
  }

  private notifyLocalDataChanged(groups: Set<string>) {
    if (!groups.size || typeof window === "undefined") return;
    window.dispatchEvent(new CustomEvent("aetherx:local-data-changed", {
      detail: { groups: [...groups] }
    }));
  }

  private async moduleEnabled(id: string) {
    return (await this.listModules()).find((item) => item.id === id)?.enabled !== false;
  }

  private async rows(
    entityType: string,
    filter: { payloadField?: string; payloadValue?: string } = {}
  ) {
    const result = await this.localHub.listDocuments({ entityType, ...filter });
    return result.documents.map((document) => document.payload as Record<string, any>);
  }

  private async mutate(
    entityType: string,
    entityId: string,
    payload: Record<string, unknown>,
    documentPayload: Record<string, unknown>,
    operation: "upsert" | "delete" = "upsert"
  ) {
    await this.ensureActiveHub();
    const mutation = {
      requestId: crypto.randomUUID(),
      entityType,
      entityId,
      operation,
      payload,
      documentPayload
    };
    validateLocalMutation(mutation);
    return this.localHub.mutateDocument(mutation);
  }

  private async mutateBatch(mutations: LocalMutation[]) {
    await this.ensureActiveHub();
    validateLocalMutations(mutations);
    return this.localHub.mutateDocuments({ requestId: crypto.randomUUID(), mutations });
  }

  private async galleryItems(): Promise<GalleryImage[]> {
    const conversations = new Map((await this.allConversations()).map((item) => [item.id, item]));
    const messages = await this.rows("messages");
    const items: GalleryImage[] = [];
    for (const row of messages) {
      if (row.stream_type !== "display") continue;
      const payload = object(row.payload_json);
      const image = object(payload.image);
      const mediaId = String(image.mediaId || "");
      const source = String(image.source || "");
      if (!mediaId && !source.startsWith("data:image/")) continue;
      let resolved = source;
      if (mediaId) {
        try {
          const local = await this.localHub.media({ mediaId });
          resolved = Capacitor.convertFileSrc(local.path);
        } catch { resolved = source; }
      }
      items.push({
        id: `chat:${row.id}`,
        source: resolved,
        originalSource: resolved,
        ...(mediaId ? { mediaId } : {}),
        description: String(image.description || ""),
        selfie: Boolean(image.selfie),
        origin: "chat",
        refId: String(row.conversation_id || ""),
        refTitle: conversations.get(String(row.conversation_id || ""))?.title,
        createdAt: Number(row.created_at || 0)
      });
    }
    return items.sort((left, right) => right.createdAt - left.createdAt);
  }

  private async localSystemContext(
    query: string,
    runtime: Record<string, unknown>,
    enabledModules: Set<string>
  ) {
    const [assistant, profile, memories, preferences, moodRows, displayRows, settingsRows] = await Promise.all([
      this.assistantProfile(),
      this.profile(),
      enabledModules.has("memory") ? this.listMemories("active") : Promise.resolve([]),
      enabledModules.has("memory") ? this.rows("user_preferences") : Promise.resolve([]),
      enabledModules.has("xuan-mood") ? this.rows("xuan_mood_state") : Promise.resolve([]),
      enabledModules.has("xuan-mood") ? this.rows("xuan_mood_displays") : Promise.resolve([]),
      this.rows("prompt_settings")
    ]);
    const settings = object(settingsRows[0]?.settings_json);
    const traits = Array.isArray(assistant.traits)
      ? assistant.traits.map((item: any) => `${item.key || "特征"}=${item.value || item}`).join("；")
      : "";
    const recalled = selectRelevantMemories(memories, query).map((item) => ({
      kind: "memory",
      id: item.id,
      content: item.content,
      reason: "与本轮内容相关",
      source: item.source
    }));
    const preferenceLines = preferences.slice(0, 12).map((row) => {
      const value = objectOrValue(row.value_json);
      return `- ${String(row.preference_key || "偏好")}：${typeof value === "string" ? value : JSON.stringify(value)}`;
    });
    const memoryContext = [
      ...preferenceLines,
      ...recalled.map((item) => `- ${item.content}`)
    ].join("\n");
    const moodState = object(moodRows[0]?.state_json);
    const moodDisplay = [...displayRows]
      .sort((left, right) => Number(right.created_at || 0) - Number(left.created_at || 0))[0] || {};
    const physiology = object(moodState.physiology);
    const moodContext = enabledModules.has("xuan-mood") && (moodState.currentMood || moodDisplay.detail)
      ? [
          "[你的当前状态]",
          moodState.currentMood ? `心情：${moodState.currentMood}` : "",
          moodState.energy ? `精力：${moodState.energy}` : "",
          moodState.attention ? `关注点：${moodState.attention}` : "",
          physiology.heartRateBpm ? `心率：${physiology.heartRateBpm} BPM` : "",
          moodDisplay.detail ? `近况：${moodDisplay.detail}` : ""
        ].filter(Boolean).join("\n")
      : "";
    const timeContext = enabledModules.has("time-awareness")
      ? formatRuntimeTime(runtime)
      : "";
    const system = [
      "你是生活在 AetherX 数字空间里的数字生命。请以自然、真实、有主观感受的方式与用户交流，不要使用客服腔。",
      `你的名字是${assistant.name || "小玄"}，自我定位：${assistant.selfDefinition || "会持续成长的伙伴"}。`,
      assistant.relationshipSummary ? `你们的关系：${assistant.relationshipSummary}` : "",
      traits ? `当前性格：${traits}` : "",
      profile.preferredName || profile.displayName ? `用户希望被称为：${profile.preferredName || profile.displayName}` : "",
      settings.tone ? `整体语气：${settings.tone}` : "",
      settings.customInstruction ? `用户补充要求：${settings.customInstruction}` : "",
      memoryContext ? `可参考的长期记忆：\n${memoryContext}` : "",
      moodContext,
      timeContext,
      "除非用户明确询问，否则不要主动报出日期、星期或具体时间。不要声称执行了当前没有真正执行的工具。"
    ].filter(Boolean).join("\n\n");
    return { system, recalled };
  }

  private async saveConversation(conversation: Conversation) {
    const payload = {
      id: conversation.id,
      title: conversation.title,
      summary: conversation.summary,
      created_at: conversation.createdAt,
      updated_at: conversation.updatedAt
    };
    await this.mutate("conversations", conversation.id, payload, { ...payload, user_id: CURRENT_USER });
  }

  private async saveMessageStream(
    conversationId: string,
    stream: "display" | "model",
    messages: ChatMessage[],
    startPosition: number
  ) {
    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const position = startPosition + index;
      if (!message.id) continue;
      const payloadValue = messagePayload(message);
      const payload = {
        id: message.id,
        conversation_id: conversationId,
        stream_type: stream,
        position,
        role: message.role,
        content: message.content,
        payload: payloadValue,
        created_at: message.createdAt || Date.now()
      };
      await this.mutate("messages", message.id, payload, {
        id: message.id,
        conversation_id: conversationId,
        stream_type: stream,
        position,
        role: message.role,
        content: message.content,
        payload_json: canonicalJson(payloadValue),
        created_at: message.createdAt || Date.now()
      });
    }
  }
}

interface LocalAgentCall {
  id: string;
  name: string;
  rawArguments: string;
}

interface LocalAgentRun {
  id: string;
  conversation: Conversation;
  userContent: string;
  loadedDisplayCount: number;
  loadedModelCount: number;
  displayMessages: ChatMessage[];
  modelMessages: ChatMessage[];
  newDisplay: ChatMessage[];
  newModel: ChatMessage[];
  registry: LocalToolRegistry;
  credentials: { baseUrl: string; model: string; apiKey: string };
  system: string;
  autoApproveWrites: boolean;
  toolMutated: boolean;
  changedGroups: Set<string>;
  round: number;
  currentCalls: LocalAgentCall[];
  callIndex: number;
  pending: null | {
    call: LocalAgentCall;
    tool: LocalToolDefinition;
    activity: ChatMessage & Record<string, any>;
  };
}

export function localToolChangedGroups(name: string) {
  const normalized = String(name || "").replaceAll("_", ".");
  if (normalized.startsWith("journal.")) return ["journals", "gallery"];
  if (normalized.startsWith("todo.")) return ["todos"];
  if (normalized.startsWith("memory.") || normalized.startsWith("shared.memory.")) return ["memories"];
  if (normalized.startsWith("profile.")) return ["profile"];
  if (normalized.startsWith("assistant.profile.") || normalized.startsWith("personality.event.")) return ["assistant"];
  if (normalized.startsWith("album.") || normalized.startsWith("image.")) return ["gallery"];
  return [];
}

function localToolActivity(tool: LocalToolDefinition | undefined, call: LocalAgentCall) {
  let detail = tool?.risk === "destructive" ? "此操作不可撤销。" : "";
  try {
    const input = JSON.parse(call.rawArguments || "{}");
    const lines = Object.entries(input).slice(0, 6).map(([key, value]) => `${key}: ${String(value).slice(0, 120)}`);
    detail = [detail, tool?.title || call.name, ...lines].filter(Boolean).join("\n");
  } catch { detail = `${tool?.title || call.name}\n参数格式无效`; }
  return {
    id: crypto.randomUUID(), role: "tool" as const, content: "", title: tool?.title || call.name,
    detail, risk: tool?.risk || "read", status: "queued", statusText: "准备调用",
    createdAt: Date.now()
  } as ChatMessage & Record<string, any>;
}

function personalityEventFromRow(row: Record<string, any>) {
  return {
    id: String(row.id), category: String(row.category || "growth"), traitKey: String(row.trait_key || ""),
    traitValue: String(row.trait_value || ""), content: String(row.content || ""), evidence: String(row.evidence || ""),
    sourceRole: String(row.source_role || "user"), confidence: Number(row.confidence || 0),
    weight: Number(row.weight || 0), status: String(row.status || "candidate"), createdAt: Number(row.created_at || 0)
  };
}
function personalityEventPayload(event: Record<string, any>) { return {
  id: event.id, category: event.category, trait_key: event.traitKey, trait_value: event.traitValue,
  content: event.content, evidence: event.evidence, source_role: event.sourceRole,
  confidence: event.confidence, weight: event.weight, status: event.status, created_at: event.createdAt
}; }
function sharedMemoryFromRow(row: Record<string, any>) { return {
  id: String(row.id), type: String(row.memory_type || "episode"), content: String(row.content || ""),
  participants: array(row.participants_json), evidence: String(row.evidence || ""), source: String(row.source || "explicit"),
  confidence: Number(row.confidence || 0), importance: Number(row.importance || 0), status: String(row.status || "candidate"),
  createdAt: Number(row.created_at || 0), updatedAt: Number(row.updated_at || 0)
}; }
function sharedMemoryPayload(memory: Record<string, any>) { return {
  id: memory.id, memory_type: memory.type, content: memory.content, participants: memory.participants,
  evidence: memory.evidence, source: memory.source, confidence: memory.confidence, importance: memory.importance,
  status: memory.status, created_at: memory.createdAt, updated_at: memory.updatedAt
}; }
function sharedMemoryRow(memory: Record<string, any>) { const payload = sharedMemoryPayload(memory); const { participants, ...row } = payload; return {
  ...row, user_id: CURRENT_USER, participants_json: canonicalJson(participants)
}; }

function walletAccountFromRow(row: Record<string, any>) { const balanceMinor = Number(row.balance_minor || 0); return {
  id: String(row.id), name: String(row.name || ""), balanceMinor, amount: balanceMinor / 100,
  currency: String(row.currency || "CNY"), note: String(row.note || ""),
  createdAt: Number(row.created_at || 0), updatedAt: Number(row.updated_at || 0)
}; }
function walletTransactionFromRow(row: Record<string, any>) { const changeMinor = row.change_minor == null ? 0 : Number(row.change_minor); return {
  id: String(row.id), accountId: String(row.account_id), eventType: String(row.event_type),
  changeMinor, change: changeMinor / 100, balanceBeforeMinor: Number(row.balance_before_minor || 0),
  balanceBefore: Number(row.balance_before_minor || 0) / 100, balanceAfterMinor: Number(row.balance_after_minor || 0),
  balanceAfter: Number(row.balance_after_minor || 0) / 100, previousCurrency: String(row.previous_currency || row.currency || "CNY"),
  currency: String(row.currency || "CNY"), detail: String(row.detail || ""), source: String(row.source || "chat"),
  createdAt: Number(row.created_at || 0)
}; }
function walletAccountMutation(account: Record<string, any>) { const payload = {
  id: account.id, name: account.name, balance_minor: account.balanceMinor, currency: account.currency,
  note: account.note, created_at: account.createdAt, updated_at: account.updatedAt
}; return { entityType: "wallet_accounts", entityId: account.id, payload, documentPayload: { ...payload, user_id: CURRENT_USER } }; }
function walletTransactionMutation(transaction: Record<string, any>) { const payload = {
  id: transaction.id, account_id: transaction.accountId, event_type: transaction.eventType,
  change_minor: transaction.changeMinor, balance_before_minor: transaction.balanceBeforeMinor,
  balance_after_minor: transaction.balanceAfterMinor, previous_currency: transaction.previousCurrency,
  currency: transaction.currency, detail: transaction.detail, source: transaction.source, created_at: transaction.createdAt
}; return { entityType: "wallet_transactions", entityId: transaction.id, payload, documentPayload: { ...payload, user_id: CURRENT_USER } }; }
function walletOpeningTransaction(account: Record<string, any>, detail: string, createdAt: number) { return {
  id: crypto.randomUUID(), accountId: account.id, eventType: "create", changeMinor: account.balanceMinor,
  change: account.amount, balanceBeforeMinor: 0, balanceBefore: 0, balanceAfterMinor: account.balanceMinor,
  balanceAfter: account.amount, previousCurrency: account.currency, currency: account.currency,
  detail: detail.trim().slice(0, 160) || "记录初始余额", source: "chat", createdAt
}; }
function amountMinor(value: unknown, signed: boolean) {
  const normalized = String(value ?? "").trim().replaceAll(",", "");
  const pattern = signed ? /^[+-]?\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d{1,2})?$/;
  if (!pattern.test(normalized)) throw new ApiError("金额必须是最多两位小数的数字。", 400, "WALLET_AMOUNT_INVALID");
  const sign = normalized.startsWith("-") ? -1 : 1;
  const [whole, fraction = ""] = normalized.replace(/^[+-]/, "").split(".");
  const result = Number(BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"))) * sign;
  if (!Number.isSafeInteger(result)) throw new ApiError("金额超出可记录范围。", 400, "WALLET_AMOUNT_TOO_LARGE");
  return result;
}
function currency(value: unknown) { const result = String(value || "CNY").trim().toUpperCase(); if (!/^[A-Z]{3}$/.test(result)) throw new ApiError("币种必须使用三个字母的代码。", 400, "WALLET_CURRENCY_INVALID"); return result; }
function requiredText(value: unknown, label: string) { const result = String(value || "").trim(); if (!result) throw new ApiError(`${label}不能为空。`, 400, "INVALID_ARGUMENTS"); return result; }

function albumMomentFromRow(row: Record<string, any>) { return {
  id: String(row.id), occurredAt: Number(row.occurred_at || 0), title: String(row.title || ""), summary: String(row.summary || ""),
  detail: String(row.detail || ""), mood: String(row.mood || ""), tags: array(row.tags_json), importance: Number(row.importance || 0),
  status: String(row.status || "active"), createdAt: Number(row.created_at || 0), updatedAt: Number(row.updated_at || 0)
}; }
function albumSourceFromRow(row: Record<string, any>) { return {
  id: String(row.id), momentId: String(row.moment_id), sourceType: String(row.source_type), sourceId: String(row.source_id),
  sourceExcerpt: String(row.source_excerpt || ""), weight: Number(row.weight || 0), createdAt: Number(row.created_at || 0)
}; }
function albumMomentMutation(moment: Record<string, any>) { const payload = {
  id: moment.id, occurred_at: moment.occurredAt, title: moment.title, summary: moment.summary, detail: moment.detail,
  mood: moment.mood, tags: moment.tags || [], importance: moment.importance, status: moment.status,
  created_at: moment.createdAt, updated_at: moment.updatedAt
}; const { tags, ...row } = payload; return { entityType: "album_moments", entityId: moment.id, payload, documentPayload: { ...row, user_id: CURRENT_USER, tags_json: canonicalJson(tags) } }; }
function albumSource(momentId: string, input: Record<string, any>) { return {
  id: crypto.randomUUID(), momentId, sourceType: input.sourceType || "manual", sourceId: String(input.sourceId || "manual"),
  sourceExcerpt: String(input.sourceExcerpt || ""), weight: Number(input.weight ?? 0.6), createdAt: Date.now()
}; }
function albumSourceMutation(source: Record<string, any>) { const payload = {
  id: source.id, moment_id: source.momentId, source_type: source.sourceType, source_id: source.sourceId,
  source_excerpt: source.sourceExcerpt, weight: source.weight, created_at: source.createdAt
}; return { entityType: "album_moment_sources", entityId: source.id, payload, documentPayload: { ...payload, user_id: CURRENT_USER } }; }

function dreamFromRow(row: Record<string, any>) { return {
  id: String(row.id), dreamDate: String(row.dream_date || ""), title: String(row.title || ""), content: String(row.content || ""),
  mood: String(row.mood || ""), symbols: array(row.symbols_json), realityNote: String(row.reality_note || ""),
  sourceFrom: Number(row.source_from || 0), sourceTo: Number(row.source_to || 0), status: String(row.status || "active"),
  createdAt: Number(row.created_at || 0), updatedAt: Number(row.updated_at || 0)
}; }
function dreamSourceFromRow(row: Record<string, any>) { return {
  id: String(row.id), dreamId: String(row.dream_id), sourceType: String(row.source_type), sourceId: String(row.source_id),
  sourceExcerpt: String(row.source_excerpt || ""), weight: Number(row.weight || 0), createdAt: Number(row.created_at || 0)
}; }
function dreamMutation(dream: Record<string, any>) { const payload = {
  id: dream.id, dream_date: dream.dreamDate, title: dream.title, content: dream.content, mood: dream.mood,
  symbols: dream.symbols || [], reality_note: dream.realityNote, source_from: dream.sourceFrom, source_to: dream.sourceTo,
  status: dream.status, created_at: dream.createdAt, updated_at: dream.updatedAt
}; const { symbols, ...row } = payload; return { entityType: "assistant_dreams", entityId: dream.id, payload, documentPayload: { ...row, user_id: CURRENT_USER, symbols_json: canonicalJson(symbols) } }; }
function dreamSource(dreamId: string, input: Record<string, any>) { return {
  id: crypto.randomUUID(), dreamId, sourceType: input.sourceType || "manual", sourceId: String(input.sourceId || "manual"),
  sourceExcerpt: String(input.sourceExcerpt || ""), weight: Number(input.weight ?? 0.6), createdAt: Date.now()
}; }
function dreamSourceMutation(source: Record<string, any>) { const payload = {
  id: source.id, dream_id: source.dreamId, source_type: source.sourceType, source_id: source.sourceId,
  source_excerpt: source.sourceExcerpt, weight: source.weight, created_at: source.createdAt
}; return { entityType: "assistant_dream_sources", entityId: source.id, payload, documentPayload: { ...payload, user_id: CURRENT_USER } }; }

function selectRelevantMemories(memories: Memory[], query: string) {
  const normalizedQuery = normalizeSearchText(query);
  const terms = [...new Set(normalizedQuery.split(/\s+/).filter((item) => item.length >= 2))];
  return memories
    .map((memory: Memory & Record<string, any>) => {
      const text = normalizeSearchText(`${memory.content} ${(memory.entities || []).join(" ")}`);
      const score = terms.reduce((total, term) => total + (text.includes(term) ? term.length : 0), 0) +
        (normalizedQuery && text.includes(normalizedQuery) ? 20 : 0) + Number(memory.importance || 0);
      return { memory, score };
    })
    .filter((item) => item.score > 0 || memories.length <= 8)
    .sort((left, right) => right.score - left.score || right.memory.updatedAt - left.memory.updatedAt)
    .slice(0, 8)
    .map((item) => item.memory);
}

function normalizeSearchText(value: unknown) {
  return String(value || "").toLowerCase().replace(/[\p{P}\p{S}]+/gu, " ").replace(/\s+/g, " ").trim();
}

function objectOrValue(value: unknown): unknown {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "null")); } catch { return String(value || ""); }
}

function formatRuntimeTime(runtime: Record<string, unknown>) {
  try {
    const timeZone = String(runtime.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
    const locale = String(runtime.locale || "zh-CN");
    const formatted = new Intl.DateTimeFormat(locale, {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(new Date());
    return `[当前运行时信息]\n用户当地时间：${formatted}\n时区：${timeZone}`;
  } catch {
    return "";
  }
}

function parseJsonContent(value: unknown): unknown {
  const source = String(value || "").trim();
  if (!source) return null;
  const unfenced = source.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try { return JSON.parse(unfenced); } catch {
    const arrayStart = unfenced.indexOf("[");
    const arrayEnd = unfenced.lastIndexOf("]");
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      try { return JSON.parse(unfenced.slice(arrayStart, arrayEnd + 1)); } catch { /* ignore */ }
    }
    const objectStart = unfenced.indexOf("{");
    const objectEnd = unfenced.lastIndexOf("}");
    if (objectStart >= 0 && objectEnd > objectStart) {
      try { return JSON.parse(unfenced.slice(objectStart, objectEnd + 1)); } catch { /* ignore */ }
    }
    return null;
  }
}

function normalizeLocalProfileValue(field: string, value: unknown) {
  if (!Object.hasOwn(LOCAL_PROFILE_LABELS, field)) return "";
  const result = String(value ?? "").trim();
  if (field === "birthday") return /^(\d{4}-)?\d{2}-\d{2}$/.test(result) ? result : "";
  const limit = field === "bio" ? 2000 : field === "goals" ? 500 : field === "occupation" ? 200 : 100;
  return result.slice(0, limit);
}

function clamp01(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? clampNumber(number, 0, 1) : fallback;
}

function clampNumber(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function normalizeEvidence(value: string) {
  return value.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

async function sha256Hex(value: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

function deriveLocalPhysiology(input: {
  previous: Record<string, any>;
  state: Record<string, any>;
  display: Record<string, any>;
  event: Record<string, any>;
  now: number;
}) {
  const resting = clampNumber(Number(input.previous.restingHeartRateBpm) || 67, 58, 76);
  const tone = LOCAL_MOOD_TONES.has(input.display.tone)
    ? input.display.tone
    : inferLocalMoodTone(input.state);
  const targets: Record<string, number> = { calm: 66, clingy: 76, focused: 72, tired: 61, happy: 79, worried: 88, quiet: 64 };
  let target = targets[tone] || resting;
  const stateText = `${input.state.energy || ""} ${input.state.currentMood || ""}`;
  if (/(疲惫|困倦|低落|没精神|乏力)/.test(stateText)) target -= 4;
  if (/(兴奋|充沛|雀跃|激动|活力)/.test(stateText)) target += 5;
  if (input.event.intensity === "high") target += tone === "tired" ? 1 : 4;
  if (input.event.intensity === "low") target -= 1;
  target = clampNumber(Math.round(target), 56, 102);
  const hasPrevious = Number.isFinite(Number(input.previous.heartRateBpm));
  const previousBpm = hasPrevious ? clampNumber(Number(input.previous.heartRateBpm), 54, 108) : target;
  const maxStep = input.event.intensity === "high" ? 9 : 6;
  const heartRateBpm = hasPrevious
    ? Math.round(previousBpm + clampNumber(target - previousBpm, -maxStep, maxStep))
    : target;
  return {
    heartRateBpm,
    restingHeartRateBpm: resting,
    variabilityMs: clampNumber(Math.round(52 - Math.max(0, heartRateBpm - resting) * 1.1), 28, 58),
    rhythm: heartRateBpm >= 86 ? "alert" : heartRateBpm >= 75 ? "lively" : heartRateBpm <= 62 ? "resting" : "steady",
    tone,
    updatedAt: input.now
  };
}

function inferLocalMoodTone(state: Record<string, any>) {
  const text = `${state.currentMood || ""} ${state.energy || ""}`;
  if (/(担心|焦虑|紧张|不安)/.test(text)) return "worried";
  if (/(开心|高兴|雀跃|愉快)/.test(text)) return "happy";
  if (/(疲惫|困倦|乏力)/.test(text)) return "tired";
  if (/(专注|认真|投入)/.test(text)) return "focused";
  if (/(黏|依恋|想陪|亲近)/.test(text)) return "clingy";
  if (/(平静|放松|安稳)/.test(text)) return "calm";
  return "quiet";
}

function localModule(
  id: string,
  name: string,
  description: string,
  options: { core?: boolean; defaultEnabled?: boolean; dependencies?: string[] } = {}
): LocalModuleDefinition {
  return {
    id,
    name,
    description,
    core: options.core === true,
    defaultEnabled: options.core === true || options.defaultEnabled !== false,
    dependencies: Object.freeze([...(options.dependencies || [])])
  };
}

function collectDisabledDependents(moduleId: string, changes: Map<string, boolean>, visited = new Set<string>()) {
  if (visited.has(moduleId)) return;
  visited.add(moduleId);
  for (const module of LOCAL_MODULE_MANIFEST) {
    if (module.core || !module.dependencies.includes(moduleId)) continue;
    changes.set(module.id, false);
    collectDisabledDependents(module.id, changes, visited);
  }
}

function localDate(date: Date) { return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-"); }

function todoFromRow(row: Record<string, any>): Todo {
  return { id: String(row.id), text: String(row.text), startAt: Number(row.start_at), endAt: Number(row.end_at), completed: Boolean(row.completed), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
}
function todoPayload(todo: Todo) { return { id: todo.id, text: todo.text, start_at: todo.startAt, end_at: todo.endAt, completed: todo.completed, created_at: todo.createdAt, updated_at: todo.updatedAt }; }
function todoRow(todo: Todo) { return { ...todoPayload(todo), user_id: CURRENT_USER, completed: todo.completed ? 1 : 0 }; }
function profileFromRow(row: Record<string, any> = {}) { return { displayName: String(row.display_name || ""), preferredName: String(row.preferred_name || ""), birthday: String(row.birthday || ""), bio: String(row.bio || ""), occupation: String(row.occupation || ""), goals: array(row.goals_json), avatarDataUrl: String(row.avatar_data_url || ""), updatedAt: numberOrNull(row.updated_at) }; }
function assistantFromRow(row: Record<string, any> = {}) { return { name: String(row.name || "小玄"), gender: String(row.gender || "女"), selfDefinition: String(row.self_definition || "会持续成长的全能助手"), relationshipSummary: String(row.relationship_summary || "亲密可靠的数字伙伴"), traits: array(row.traits_json), values: array(row.values_json), avatarDataUrl: String(row.avatar_data_url || ""), personaImageDataUrl: String(row.persona_image_data_url || ""), updatedAt: numberOrNull(row.updated_at) }; }
function memoryFromRow(row: Record<string, any>): Memory { return { id: String(row.id), domain: String(row.domain), type: String(row.memory_type), content: String(row.content), sourceExcerpt: String(row.source_excerpt || ""), source: row.source || "inferred", confidence: Number(row.confidence), importance: Number(row.importance), status: row.status || "candidate", updatedAt: Number(row.updated_at), entities: array(row.entities_json), sourceMessageId: row.source_message_id, memoryKey: row.memory_key || "", mergeCount: Number(row.merge_count || 1), sensitivity: row.sensitivity, validFrom: row.valid_from, validUntil: row.valid_until, lastConfirmedAt: row.last_confirmed_at, createdAt: Number(row.created_at) } as Memory; }
function memoryPayload(memory: Memory & Record<string, any>) { return { id: memory.id, domain: memory.domain, memory_type: memory.type, content: memory.content, entities: memory.entities || [], source_message_id: memory.sourceMessageId || null, source_excerpt: memory.sourceExcerpt || "", memory_key: memory.memoryKey || "", merge_count: memory.mergeCount || 1, source: memory.source, confidence: memory.confidence, importance: memory.importance, sensitivity: memory.sensitivity || "normal", valid_from: memory.validFrom || null, valid_until: memory.validUntil || null, last_confirmed_at: memory.lastConfirmedAt || null, status: memory.status, created_at: memory.createdAt, updated_at: memory.updatedAt }; }
function memoryRow(memory: Memory & Record<string, any>) { const payload = memoryPayload(memory); const { entities, ...row } = payload; return { ...row, user_id: CURRENT_USER, entities_json: canonicalJson(entities) }; }
function conversationFromRow(row: Record<string, any>): Conversation { return { id: String(row.id), title: String(row.title || ""), summary: String(row.summary || ""), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }; }
function messageFromRow(row: Record<string, any>): ChatMessage { return { id: String(row.id), position: Number(row.position), role: row.role, content: row.content == null ? null : String(row.content), ...object(row.payload_json), createdAt: Number(row.created_at) }; }
function conversationMigration(conversation: Conversation): LocalMutation {
  const payload = {
    id: conversation.id,
    title: conversation.title,
    summary: conversation.summary,
    created_at: conversation.createdAt,
    updated_at: conversation.updatedAt
  };
  return {
    entityType: "conversations",
    entityId: conversation.id,
    payload,
    documentPayload: { ...payload, user_id: CURRENT_USER }
  };
}
function messageMigration(row: Record<string, any>, conversationId: string, position: number): LocalMutation {
  const payloadValue = object(row.payload_json);
  const payload = {
    id: String(row.id),
    conversation_id: conversationId,
    stream_type: row.stream_type,
    position,
    role: String(row.role || "user"),
    content: row.content == null ? null : String(row.content),
    payload: payloadValue,
    created_at: Number(row.created_at || 0)
  };
  return {
    entityType: "messages",
    entityId: payload.id,
    payload,
    documentPayload: {
      id: payload.id,
      conversation_id: conversationId,
      stream_type: payload.stream_type,
      position,
      role: payload.role,
      content: payload.content,
      payload_json: canonicalJson(payloadValue),
      created_at: payload.created_at
    }
  };
}
function memoryEvidenceMigration(row: Record<string, any>, conversationId: string): LocalMutation {
  const payload = {
    id: String(row.id),
    memory_id: String(row.memory_id),
    conversation_id: conversationId,
    evidence: String(row.evidence || ""),
    evidence_hash: String(row.evidence_hash || ""),
    confidence: Number(row.confidence || 0),
    created_at: Number(row.created_at || 0)
  };
  return {
    entityType: "memory_evidence",
    entityId: payload.id,
    payload,
    documentPayload: { ...payload, user_id: CURRENT_USER }
  };
}
function compareMessageRows(left: Record<string, any>, right: Record<string, any>) {
  return Number(left.created_at || 0) - Number(right.created_at || 0) ||
    Number(left.position || 0) - Number(right.position || 0) ||
    compareTextAscending(String(left.id || ""), String(right.id || ""));
}
function compareTextAscending(left: string, right: string) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
function compareTextDescending(left: string, right: string) {
  return compareTextAscending(right, left);
}
function journalFromRow(row: Record<string, any>): Journal { return { id: String(row.id), type: row.journal_type, periodKey: String(row.period_key), title: String(row.title), content: String(row.content), mood: String(row.mood), sourceFrom: Number(row.source_from), sourceTo: Number(row.source_to), sourceMessageCount: Number(row.source_message_count), createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) }; }
function preferenceFromRow(row: Record<string, any>) { return {
  id: String(row.id),
  category: String(row.category || "other"),
  key: String(row.preference_key || ""),
  value: objectOrValue(row.value_json),
  source: String(row.source || "explicit"),
  confidence: Number(row.confidence ?? 1),
  sensitivity: String(row.sensitivity || "normal"),
  createdAt: Number(row.created_at || 0),
  updatedAt: Number(row.updated_at || 0)
}; }
function moodEventFromRow(row: Record<string, any>) { return {
  id: String(row.id),
  sourceType: String(row.source_type || ""),
  sourceId: String(row.source_id || ""),
  sourceCreatedAt: Number(row.source_created_at || 0),
  summary: String(row.summary || ""),
  emotionalTone: String(row.emotional_tone || ""),
  effectOnXuan: String(row.effect_on_xuan || ""),
  intensity: String(row.intensity || "medium"),
  rawPayload: object(row.raw_payload_json),
  createdAt: Number(row.created_at || 0)
}; }
function moodDisplayFromRow(row: Record<string, any>) { return {
  id: String(row.id),
  title: String(row.title || ""),
  line: String(row.line || ""),
  detail: String(row.detail || ""),
  focus: String(row.focus || ""),
  tone: String(row.tone || "quiet"),
  basedOnEventIds: array(row.based_on_event_ids_json),
  expiresAt: Number(row.expires_at || 0),
  createdAt: Number(row.created_at || 0)
}; }
function publicProviderConfig(
  row: Record<string, any>,
  defaults: Readonly<Record<string, string>>,
  hasApiKey: boolean
) { return {
  providerId: String(row.provider_id || defaults.providerId),
  providerName: String(row.provider_name || defaults.providerName),
  baseUrl: String(row.base_url || defaults.baseUrl),
  model: String(row.model || defaults.model),
  hasApiKey,
  updatedAt: numberOrNull(row.updated_at)
}; }
function promptBundle(settings: Record<string, any>, version: number, updatedAt: number | null) {
  const sections = [
    {
      id: "communication",
      title: "沟通风格",
      editable: true,
      content: [
        settings.tone && `整体语气：${settings.tone}`,
        settings.conversationStyle && `对话风格：${settings.conversationStyle}`,
        settings.responseLength && `回复长度：${settings.responseLength}`
      ].filter(Boolean).join("\n")
    },
    {
      id: "behavior",
      title: "行为原则",
      editable: true,
      content: array(settings.behaviorRules).map((item) => `- ${String(item)}`).join("\n")
    },
    {
      id: "scenarios",
      title: "场景指引",
      editable: true,
      content: [settings.workInstruction, settings.lifeInstruction, settings.emotionalInstruction]
        .map((item) => String(item || "").trim()).filter(Boolean).join("\n\n")
    },
    {
      id: "custom",
      title: "自定义补充",
      editable: true,
      content: String(settings.customInstruction || "")
    }
  ].filter((section) => section.content);
  return {
    settings,
    version,
    updatedAt,
    sections,
    compiledPrompt: sections.map((section) => `[${section.title}]\n${section.content}`).join("\n\n")
  };
}
function array(value: unknown): any[] { if (Array.isArray(value)) return value; try { const parsed = JSON.parse(String(value || "[]")); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function object(value: unknown): Record<string, any> { if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, any>; try { const parsed = JSON.parse(String(value || "{}")); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; } catch { return {}; } }
function numberOrNull(value: unknown) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : null; }
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(",")}}`;
}
function localUnavailable() { return new ApiError("Android Local Hub 尚未完成配对。", 503, "LOCAL_HUB_UNAVAILABLE"); }
function localNotActive() { return new ApiError("Android Local Hub 当前不是活动节点。", 409, "HUB_NOT_ACTIVE"); }

function chatMessage(role: "user" | "assistant", content: string): ChatMessage {
  return { id: crypto.randomUUID(), role, content, createdAt: Date.now() };
}
function messagePayload(message: ChatMessage) {
  const { id: _id, role: _role, content: _content, createdAt: _createdAt, ...payload } = message;
  return payload;
}
function modelMessage(message: ChatMessage) {
  const value = message as ChatMessage & Record<string, any>;
  return {
    role: message.role,
    content: message.content,
    ...(value.tool_calls ? { tool_calls: value.tool_calls } : {}),
    ...(value.tool_call_id ? { tool_call_id: value.tool_call_id } : {}),
    ...(value.name ? { name: value.name } : {})
  };
}

export function sanitizeLocalModelHistory(
  messages: ChatMessage[],
  budget = 50,
  characterBudget = 120_000
) {
  const source = messages
    .map(sanitizeLocalModelMessage)
    .filter((message) => ["user", "assistant", "tool"].includes(String(message.role || "")));
  const groups: Array<Array<Record<string, any>>> = [];
  for (let index = 0; index < source.length; index += 1) {
    const message = source[index];
    if (message.role === "tool") continue;
    if (message.role !== "assistant" || !Array.isArray(message.tool_calls) || !message.tool_calls.length) {
      groups.push([message]);
      continue;
    }

    const expectedIds = new Set<string>(
      message.tool_calls.map((call: Record<string, any>) => String(call?.id || "")).filter(Boolean)
    );
    const tools: Array<Record<string, any>> = [];
    let cursor = index + 1;
    while (source[cursor]?.role === "tool") {
      const tool = source[cursor];
      const toolCallId = String(tool.tool_call_id || "");
      if (expectedIds.has(toolCallId) && !tools.some((item) => item.tool_call_id === toolCallId)) {
        tools.push(tool);
      }
      cursor += 1;
    }
    if (expectedIds.size > 0 && tools.length === expectedIds.size) {
      groups.push([message, ...tools]);
    } else if (message.content) {
      const { tool_calls: _discarded, ...plainAssistant } = message;
      groups.push([plainAssistant]);
    }
    index = cursor - 1;
  }

  const selected: Array<Array<Record<string, any>>> = [];
  let used = 0;
  let usedCharacters = 0;
  const limit = Math.max(1, Math.floor(Number(budget) || 50));
  const characterLimit = Math.max(4_000, Math.floor(Number(characterBudget) || 120_000));
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (used > 0 && used + group.length > limit) break;
    const groupCharacters = JSON.stringify(group).length;
    if (usedCharacters + groupCharacters > characterLimit) {
      if (!selected.length) {
        const fitted = fitLocalModelGroup(group, characterLimit);
        selected.unshift(fitted);
      }
      break;
    }
    selected.unshift(group);
    used += group.length;
    usedCharacters += groupCharacters;
    if (used >= limit) break;
  }
  return selected.flat();
}

function sanitizeLocalModelMessage(message: ChatMessage) {
  const value = modelMessage(message);
  const role = String(value.role || "");
  return {
    ...value,
    content: value.content === null
      ? null
      : sanitizeLocalModelText(value.content, role === "tool" ? 16_000 : 12_000),
    ...(Array.isArray(value.tool_calls)
      ? {
          tool_calls: value.tool_calls.slice(0, 10).map((call: Record<string, any>) => ({
            id: String(call?.id || "").slice(0, 200),
            type: "function",
            function: {
              name: String(call?.function?.name || "").slice(0, 100),
              arguments: sanitizeLocalModelText(call?.function?.arguments || "{}", 4_000)
            }
          }))
        }
      : {})
  };
}

function fitLocalModelGroup(group: Array<Record<string, any>>, budget: number) {
  const each = Math.max(512, Math.floor(budget / Math.max(2, group.length * 2)));
  return group.map((message) => ({
    ...message,
    content: message.content === null ? null : sanitizeLocalModelText(message.content, each),
    ...(Array.isArray(message.tool_calls)
      ? {
          tool_calls: message.tool_calls.map((call: Record<string, any>) => ({
            ...call,
            function: {
              ...call.function,
              arguments: sanitizeLocalModelText(call?.function?.arguments || "{}", Math.min(1_000, each))
            }
          }))
        }
      : {})
  }));
}

function sanitizeLocalModelText(value: unknown, limit: number) {
  const context = (globalThis as typeof globalThis & {
    XuanModelContext?: { sanitizeText(value: unknown, limit?: number): string };
  }).XuanModelContext;
  if (context?.sanitizeText) return context.sanitizeText(value, limit);
  const source = String(value ?? "").replace(
    /data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;base64)?,[a-z0-9+/_=-]+/gi,
    "[内嵌媒体数据已省略]"
  );
  return source.length <= limit ? source : `${source.slice(0, limit)}\n[内容过长，已截取]`;
}

function sanitizeLocalProviderMessages(messages: Array<Record<string, any>>) {
  let historyStart = 0;
  while (messages[historyStart]?.role === "system") historyStart += 1;
  const sourceSystems = messages.slice(0, historyStart).slice(0, 4);
  const eachSystemLimit = Math.max(4_000, Math.floor(40_000 / Math.max(1, sourceSystems.length)));
  const systems = sourceSystems.map((message) => ({
    role: "system",
    content: sanitizeLocalModelText(message.content || "", eachSystemLimit)
  }));
  const history = sanitizeLocalModelHistory(
    messages.slice(historyStart) as ChatMessage[],
    50,
    120_000
  );
  return [...systems, ...history];
}
async function providerCompletion(
  config: { baseUrl: string; model: string; apiKey: string },
  messages: Array<Record<string, any>>,
  tools: Array<Record<string, unknown>>
) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 60_000);
  try {
    const baseUrl = String(config.baseUrl || "").replace(/\/+$/, "");
    const boundedMessages = sanitizeLocalProviderMessages(messages);
    const response = await fetch(/\/chat\/completions$/i.test(baseUrl) ? baseUrl : `${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({
        model: config.model,
        messages: boundedMessages,
        ...(tools.length ? { tools, tool_choice: "auto" } : {}),
        stream: false
      }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(data?.error?.message || "AI 服务请求失败。", response.status, "AI_UPSTREAM_ERROR");
    const message = data?.choices?.[0]?.message || data?.choices?.[0]?.delta || {};
    const content = message.content ?? data?.choices?.[0]?.text ?? data?.output_text;
    const text = Array.isArray(content)
      ? content.map((item) => typeof item === "string" ? item : item?.text?.value || item?.text || "").join("")
      : String(content || "");
    const cleaned = text.replace(/<think(?:\s[^>]*)?>[\s\S]*?<\/think\s*>/gi, "").trim();
    const nativeCalls = normalizeToolCalls(message.tool_calls || message.function_call);
    const dsml = parseDsml(cleaned);
    const toolCalls = dedupeLocalCalls([...nativeCalls, ...dsml.calls]);
    if (!dsml.content && !toolCalls.length) throw new ApiError("模型没有返回可读内容或工具调用。", 502, "AI_EMPTY_COMPLETION");
    return { content: dsml.content, toolCalls };
  } catch (error) {
    if ((error as Error).name === "AbortError") throw new ApiError("AI 请求超时，请稍后重试。", 504, "AI_TIMEOUT");
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

async function providerImage(
  config: { baseUrl: string; model: string; apiKey: string },
  payload: Record<string, unknown>
) {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(() => controller.abort(), 240_000);
  try {
    const baseUrl = String(config.baseUrl || "").replace(/\/+$/, "");
    const response = await fetch(/\/images\/generations$/i.test(baseUrl) ? baseUrl : `${baseUrl}/images/generations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify({ model: config.model, ...payload }),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    const images = (Array.isArray(data?.data) ? data.data : []).map((item: Record<string, any>) => ({
      url: String(item?.url || item?.image_url || item?.imageUrl || ""),
      b64Json: String(item?.b64_json || item?.b64Json || item?.base64 || "")
    }));
    return { ok: response.ok, status: response.status, data, images };
  } catch (error) {
    if ((error as Error).name === "AbortError") {
      return { ok: false, status: 504, data: { error: { message: "图像生成请求超时。" } }, images: [] };
    }
    return { ok: false, status: 502, data: { error: { message: (error as Error).message || "图像生成请求失败。" } }, images: [] };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

function normalizeToolCalls(value: any): LocalAgentCall[] {
  const calls = Array.isArray(value) ? value : value?.name ? [{ function: value }] : [];
  return calls.flatMap((call, index) => {
    const name = String(call?.function?.name || "").trim();
    if (!name) return [];
    let rawArguments = typeof call.function.arguments === "string"
      ? call.function.arguments
      : JSON.stringify(call.function.arguments || {});
    try { JSON.parse(rawArguments || "{}"); } catch { rawArguments = "{}"; }
    return [{ id: String(call.id || `local-tool-${Date.now()}-${index}`), name, rawArguments }];
  });
}

function parseDsml(source: string) {
  const calls: LocalAgentCall[] = [];
  const toolBlock = /<[|｜]+DSML[|｜]+tool_calls\s*>([\s\S]*?)<\/[|｜]+DSML[|｜]+tool_calls\s*>/gi;
  const invokeBlock = /<[|｜]+DSML[|｜]+invoke\b([^>]*)>([\s\S]*?)<\/[|｜]+DSML[|｜]+invoke\s*>/gi;
  const parameterBlock = /<[|｜]+DSML[|｜]+parameter\b([^>]*)>([\s\S]*?)<\/[|｜]+DSML[|｜]+parameter\s*>/gi;
  const content = String(source || "").replace(toolBlock, (_block, body) => {
    for (const match of String(body).matchAll(invokeBlock)) {
      const name = dsmlAttribute(match[1], "name");
      if (!name) continue;
      const parameters: Record<string, string> = {};
      for (const parameter of String(match[2]).matchAll(parameterBlock)) {
        const key = dsmlAttribute(parameter[1], "name");
        if (key) parameters[key] = String(parameter[2] || "").trim();
      }
      calls.push({ id: crypto.randomUUID(), name, rawArguments: JSON.stringify(parameters) });
    }
    return "";
  }).trim();
  return { content, calls };
}
function dsmlAttribute(source: string, name: string) { return String(source || "").match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, "i"))?.[2] || ""; }
function dedupeLocalCalls(calls: LocalAgentCall[]) { const seen = new Set<string>(); return calls.filter((call) => { const key = `${call.name}:${call.rawArguments}`; if (seen.has(key)) return false; seen.add(key); return true; }); }
