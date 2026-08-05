const { HttpError } = require("../../lib/http-error");
const { canonicalStringify } = require("./operation-codec");
const {
  normalizeAvatarDataUrl,
  normalizePersonaImageDataUrl
} = require("../profiles/avatar-data");
const { normalizeConfig } = require("../ai/ai-config-repository");
const {
  decryptSpaceSecret,
  providerCredentialAad
} = require("./space-secret-envelope");

const SUPPORTED_ENTITY_TYPES = new Set([
  "ai_configs",
  "ai_image_configs",
  "todos",
  "user_profiles",
  "user_preferences",
  "wallet_accounts",
  "wallet_transactions",
  "conversations",
  "messages",
  "memories",
  "memory_evidence",
  "memory_settings",
  "prompt_settings",
  "prompt_setting_versions",
  "module_settings",
  "assistant_profiles",
  "assistant_personality_events",
  "shared_memories",
  "assistant_journals",
  "xuan_mood_events",
  "xuan_mood_state",
  "xuan_mood_displays",
  "album_moments",
  "album_moment_sources",
  "assistant_dreams",
  "assistant_dream_sources",
  "media_assets"
]);

const MAX_WALLET_BALANCE_MINOR = 100_000_000_000_000;

class ReplicationEntityApplier {
  constructor(database, options = {}) {
    this.database = database;
    this.secretBox = options.secretBox || null;
    this.spaceKeyService = options.spaceKeyService || null;
  }

  apply(userId, operation) {
    if (!SUPPORTED_ENTITY_TYPES.has(operation.entityType)) {
      throw new HttpError(
        409,
        "REPLICATION_ENTITY_UNSUPPORTED",
        `当前 Hub 还不能应用实体 ${operation.entityType}。`
      );
    }
    if (operation.entityType === "ai_configs") {
      return this.applyAiConfig(userId, operation, false);
    }
    if (operation.entityType === "ai_image_configs") {
      return this.applyAiConfig(userId, operation, true);
    }
    if (operation.entityType === "todos") return this.applyTodo(userId, operation);
    if (operation.entityType === "user_profiles") return this.applyProfile(userId, operation);
    if (operation.entityType === "user_preferences") {
      return this.applyPreference(userId, operation);
    }
    if (operation.entityType === "wallet_accounts") {
      return this.applyWalletAccount(userId, operation);
    }
    if (operation.entityType === "wallet_transactions") {
      return this.applyWalletTransaction(userId, operation);
    }
    if (operation.entityType === "conversations") {
      return this.applyConversation(userId, operation);
    }
    if (operation.entityType === "messages") {
      return this.applyConversationMessage(userId, operation);
    }
    if (operation.entityType === "memories") return this.applyMemory(userId, operation);
    if (operation.entityType === "memory_evidence") {
      return this.applyMemoryEvidence(userId, operation);
    }
    if (operation.entityType === "memory_settings") {
      return this.applyMemorySettings(userId, operation);
    }
    if (operation.entityType === "prompt_settings") {
      return this.applyPromptSettings(userId, operation);
    }
    if (operation.entityType === "prompt_setting_versions") {
      return this.applyPromptSettingVersion(userId, operation);
    }
    if (operation.entityType === "module_settings") {
      return this.applyModuleSetting(userId, operation);
    }
    if (operation.entityType === "assistant_profiles") {
      return this.applyAssistantProfile(userId, operation);
    }
    if (operation.entityType === "assistant_personality_events") {
      return this.applyPersonalityEvent(userId, operation);
    }
    if (operation.entityType === "shared_memories") {
      return this.applySharedMemory(userId, operation);
    }
    if (operation.entityType === "assistant_journals") {
      return this.applyJournal(userId, operation);
    }
    if (operation.entityType === "xuan_mood_events") {
      return this.applyMoodEvent(userId, operation);
    }
    if (operation.entityType === "xuan_mood_state") {
      return this.applyMoodState(userId, operation);
    }
    if (operation.entityType === "xuan_mood_displays") {
      return this.applyMoodDisplay(userId, operation);
    }
    if (operation.entityType === "album_moments") {
      return this.applyAlbumMoment(userId, operation);
    }
    if (operation.entityType === "album_moment_sources") {
      return this.applyAlbumSource(userId, operation);
    }
    if (operation.entityType === "assistant_dreams") {
      return this.applyDream(userId, operation);
    }
    if (operation.entityType === "assistant_dream_sources") {
      return this.applyDreamSource(userId, operation);
    }
    return this.applyMediaAsset(userId, operation);
  }

  applyMediaAsset(userId, operation) {
    const payload = operation.payload;
    requireUpsert(operation);
    requireMatchingId(payload.id, operation.entityId);
    const mimeType = enumValue(payload.mime_type, "mime_type", [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif"
    ]);
    const fileName = requiredText(payload.file_name, "file_name", 255);
    if (
      fileName === "." ||
      fileName === ".." ||
      fileName.includes("/") ||
      fileName.includes("\\")
    ) {
      invalidPayload("file_name", "媒体文件名不能包含路径。")
    }
    const byteSize = positiveSafeInteger(payload.byte_size, "byte_size");
    const contentHash = requiredText(payload.content_hash, "content_hash", 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(contentHash)) {
      invalidPayload("content_hash", "媒体内容摘要不是有效的 SHA-256。")
    }
    const createdAt = safeInteger(payload.created_at, "created_at");
    this.assertOwnership("media_assets", userId, operation.entityId);
    const existing = this.database.prepare(
      `SELECT mime_type, file_name, byte_size, content_hash, created_at
       FROM media_assets WHERE user_id = ? AND id = ?`
    ).get(userId, operation.entityId);
    if (existing && (
      existing.mime_type !== mimeType ||
      existing.file_name !== fileName ||
      existing.byte_size !== byteSize ||
      existing.content_hash !== contentHash ||
      existing.created_at !== createdAt
    )) {
      throw new HttpError(
        409,
        "REPLICATION_MEDIA_IDENTITY_CONFLICT",
        "媒体 Operation 与本机已验证原图的元数据不一致。"
      );
    }
    // 原图必须先经过独立分块通道的逐块和整文件 SHA-256 校验，
    // 因此这里只确认 Operation 连续性与元数据，不提前创建正式媒体记录。
  }

  applyTodo(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("todos", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database.prepare("DELETE FROM todos WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const text = requiredText(payload.text, "text", 1000);
    const startAt = safeInteger(payload.start_at, "start_at");
    const endAt = safeInteger(payload.end_at, "end_at");
    if (endAt <= startAt) invalidPayload("end_at", "待办结束时间必须晚于开始时间。");
    const completed = boolean(payload.completed, "completed");
    const createdAt = safeInteger(payload.created_at, "created_at");
    const updatedAt = safeInteger(payload.updated_at, "updated_at");
    this.database.prepare(
      `INSERT INTO todos(
         id, user_id, text, start_at, end_at, completed, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         text = excluded.text,
         start_at = excluded.start_at,
         end_at = excluded.end_at,
         completed = excluded.completed,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      operation.entityId,
      userId,
      text,
      startAt,
      endAt,
      completed ? 1 : 0,
      createdAt,
      updatedAt
    );
  }

  applyAiConfig(userId, operation, image) {
    if (operation.entityId !== "config") {
      invalidPayload("entityId", "Provider 配置只能使用固定逻辑实体 config。");
    }
    requireUpsert(operation);
    if (!this.secretBox || !this.spaceKeyService) {
      throw new HttpError(
        500,
        "REPLICATION_SECRET_SERVICE_UNAVAILABLE",
        "当前 Hub 没有配置复制凭证所需的密钥服务。"
      );
    }
    const payload = operation.payload;
    const normalized = normalizeConfig({
      providerId: payload.provider_id,
      providerName: payload.provider_name,
      baseUrl: payload.base_url,
      model: payload.model
    });
    const spaceKey = this.spaceKeyService.ensure(operation.spaceId);
    const apiKey = decryptSpaceSecret(
      payload.credential,
      spaceKey.key,
      providerCredentialAad(
        operation.spaceId,
        operation.entityType,
        operation.entityId
      ),
      spaceKey.keyVersion
    );
    const encryptedApiKey = apiKey ? this.secretBox.encrypt(apiKey) : "";
    const table = image ? "ai_image_configs" : "ai_configs";
    this.database.prepare(
      `INSERT INTO ${table}(
         user_id, provider_id, provider_name, base_url, model,
         encrypted_api_key, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         provider_id = excluded.provider_id,
         provider_name = excluded.provider_name,
         base_url = excluded.base_url,
         model = excluded.model,
         encrypted_api_key = excluded.encrypted_api_key,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      normalized.providerId,
      normalized.providerName,
      normalized.baseUrl,
      normalized.model,
      encryptedApiKey,
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyProfile(userId, operation) {
    if (operation.entityId !== "profile") {
      invalidPayload("entityId", "用户资料只能使用固定逻辑实体 profile。");
    }
    if (operation.operation === "delete") {
      this.database.prepare("DELETE FROM user_profiles WHERE user_id = ?").run(userId);
      return;
    }
    requireUpsert(operation);
    const payload = operation.payload;
    const goals = stringArray(payload.goals, "goals", 30, 500);
    this.database.prepare(
      `INSERT INTO user_profiles(
         user_id, display_name, preferred_name, birthday, bio, occupation,
         goals_json, avatar_data_url, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         display_name = excluded.display_name,
         preferred_name = excluded.preferred_name,
         birthday = excluded.birthday,
         bio = excluded.bio,
         occupation = excluded.occupation,
         goals_json = excluded.goals_json,
         avatar_data_url = excluded.avatar_data_url,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      text(payload.display_name, "display_name", 100),
      text(payload.preferred_name, "preferred_name", 100),
      text(payload.birthday, "birthday", 10),
      text(payload.bio, "bio", 2000),
      text(payload.occupation, "occupation", 200),
      JSON.stringify(goals),
      normalizeAvatarDataUrl(payload.avatar_data_url),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyPreference(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("user_preferences", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database
        .prepare("DELETE FROM user_preferences WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const source = enumValue(payload.source, "source", ["explicit", "inferred"]);
    const sensitivity = enumValue(
      payload.sensitivity,
      "sensitivity",
      ["normal", "personal", "sensitive"]
    );
    const confidence = Number(payload.confidence);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      invalidPayload("confidence", "偏好置信度必须在 0 到 1 之间。");
    }
    const logicalOwner = this.database.prepare(
      `SELECT id FROM user_preferences
       WHERE user_id = ? AND category = ? AND preference_key = ?`
    ).get(userId, payload.category, payload.preference_key);
    if (logicalOwner && logicalOwner.id !== operation.entityId) {
      throw new HttpError(
        409,
        "REPLICATION_ENTITY_ID_CONFLICT",
        "同一偏好逻辑键在本地对应了不同实体 ID。"
      );
    }
    this.database.prepare(
      `INSERT INTO user_preferences(
         id, user_id, category, preference_key, value_json, source,
         confidence, sensitivity, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         category = excluded.category,
         preference_key = excluded.preference_key,
         value_json = excluded.value_json,
         source = excluded.source,
         confidence = excluded.confidence,
         sensitivity = excluded.sensitivity,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      operation.entityId,
      userId,
      requiredText(payload.category, "category", 60),
      requiredText(payload.preference_key, "preference_key", 100),
      JSON.stringify(payload.value),
      source,
      confidence,
      sensitivity,
      safeInteger(payload.created_at, "created_at"),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyWalletAccount(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("wallet_accounts", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database
        .prepare("DELETE FROM wallet_accounts WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const currency = walletCurrency(payload.currency, "currency");
    this.database.prepare(
      `INSERT INTO wallet_accounts(
         id, user_id, name, balance_minor, currency, note, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         name = excluded.name,
         balance_minor = excluded.balance_minor,
         currency = excluded.currency,
         note = excluded.note,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      operation.entityId,
      userId,
      requiredText(payload.name, "name", 60),
      walletMinor(payload.balance_minor, "balance_minor"),
      currency,
      text(payload.note, "note", 240),
      safeInteger(payload.created_at, "created_at"),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyWalletTransaction(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("wallet_transactions", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database
        .prepare("DELETE FROM wallet_transactions WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const accountId = requiredText(payload.account_id, "account_id", 200);
    const account = this.database
      .prepare("SELECT user_id FROM wallet_accounts WHERE id = ?")
      .get(accountId);
    if (!account || account.user_id !== userId) {
      throw new HttpError(
        409,
        "REPLICATION_WALLET_ACCOUNT_MISSING",
        "钱包流水引用的存款账户尚不存在或属于其他账号。"
      );
    }
    const current = this.database
      .prepare("SELECT account_id FROM wallet_transactions WHERE id = ?")
      .get(operation.entityId);
    if (current && current.account_id !== accountId) {
      throw new HttpError(
        409,
        "REPLICATION_ENTITY_ID_CONFLICT",
        "同一钱包流水 ID 不能移动到另一个存款账户。"
      );
    }
    const eventType = enumValue(
      payload.event_type,
      "event_type",
      ["create", "deposit", "withdrawal", "set", "edit"]
    );
    const changeMinor = nullableWalletMinor(payload.change_minor, "change_minor");
    const balanceBeforeMinor = walletMinor(
      payload.balance_before_minor,
      "balance_before_minor"
    );
    const balanceAfterMinor = walletMinor(
      payload.balance_after_minor,
      "balance_after_minor"
    );
    if (
      changeMinor !== null &&
      balanceBeforeMinor + changeMinor !== balanceAfterMinor
    ) {
      invalidPayload("change_minor", "钱包流水的金额变化与前后余额不一致。");
    }
    if (eventType === "deposit" && !(changeMinor > 0)) {
      invalidPayload("change_minor", "收入流水必须使用正数金额。");
    }
    if (eventType === "withdrawal" && !(changeMinor < 0)) {
      invalidPayload("change_minor", "支出流水必须使用负数金额。");
    }
    if (
      eventType === "create" &&
      (balanceBeforeMinor !== 0 || changeMinor !== balanceAfterMinor)
    ) {
      invalidPayload("event_type", "期初余额流水的前后金额不一致。");
    }
    this.database.prepare(
      `INSERT INTO wallet_transactions(
         id, user_id, account_id, event_type, change_minor,
         balance_before_minor, balance_after_minor, previous_currency,
         currency, detail, source, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         account_id = excluded.account_id,
         event_type = excluded.event_type,
         change_minor = excluded.change_minor,
         balance_before_minor = excluded.balance_before_minor,
         balance_after_minor = excluded.balance_after_minor,
         previous_currency = excluded.previous_currency,
         currency = excluded.currency,
         detail = excluded.detail,
         source = excluded.source,
         created_at = excluded.created_at`
    ).run(
      operation.entityId,
      userId,
      accountId,
      eventType,
      changeMinor,
      balanceBeforeMinor,
      balanceAfterMinor,
      walletCurrency(payload.previous_currency, "previous_currency"),
      walletCurrency(payload.currency, "currency"),
      text(payload.detail, "detail", 160),
      enumValue(payload.source, "source", ["manual", "chat"]),
      safeInteger(payload.created_at, "created_at")
    );
  }

  applyConversation(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("conversations", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database
        .prepare("DELETE FROM conversations WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    this.database.prepare(
      `INSERT INTO conversations(
         id, user_id, title, summary, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         title = excluded.title,
         summary = excluded.summary,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      operation.entityId,
      userId,
      requiredText(payload.title, "title", 120),
      text(payload.summary, "summary", 5000),
      safeInteger(payload.created_at, "created_at"),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyConversationMessage(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertMessageOwnership(userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database.prepare(
        `DELETE FROM messages
         WHERE id = ? AND conversation_id IN (
           SELECT id FROM conversations WHERE user_id = ?
         )`
      ).run(operation.entityId, userId);
      return;
    }
    requireUpsert(operation);
    const conversationId = requiredText(payload.conversation_id, "conversation_id", 200);
    const parent = this.database
      .prepare("SELECT user_id FROM conversations WHERE id = ?")
      .get(conversationId);
    if (!parent || parent.user_id !== userId) {
      throw new HttpError(
        409,
        "REPLICATION_CONVERSATION_MISSING",
        "消息引用的会话尚不存在或属于其他账号。"
      );
    }
    const content = payload.content === null
      ? null
      : text(payload.content, "content", 100_000);
    const messagePayload = jsonObject(payload.payload, "payload", 1_000_000);
    this.database.prepare(
      `INSERT INTO messages(
         id, conversation_id, stream_type, position, role,
         content, payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         conversation_id = excluded.conversation_id,
         stream_type = excluded.stream_type,
         position = excluded.position,
         role = excluded.role,
         content = excluded.content,
         payload_json = excluded.payload_json,
         created_at = excluded.created_at`
    ).run(
      operation.entityId,
      conversationId,
      enumValue(payload.stream_type, "stream_type", ["display", "model"]),
      safeInteger(payload.position, "position"),
      text(payload.role, "role", 40),
      content,
      JSON.stringify(messagePayload),
      safeInteger(payload.created_at, "created_at")
    );
  }

  assertMessageOwnership(userId, entityId) {
    const row = this.database.prepare(
      `SELECT c.user_id
       FROM messages m
       JOIN conversations c ON c.id = m.conversation_id
       WHERE m.id = ?`
    ).get(entityId);
    if (row && row.user_id !== userId) {
      throw new HttpError(
        409,
        "REPLICATION_ENTITY_OWNERSHIP_CONFLICT",
        "消息 ID 已经属于另一个本地账号。"
      );
    }
  }

  applyMemory(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("memories", userId, operation.entityId);
    if (operation.operation === "delete") {
      if (this.hasMemoryFts()) {
        this.database.prepare(
          "DELETE FROM memories_fts WHERE memory_id = ? AND user_id = ?"
        ).run(operation.entityId, userId);
      }
      this.database.prepare("DELETE FROM memories WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const entities = stringArray(payload.entities, "entities", 30, 500);
    const content = requiredText(payload.content, "content", 5000);
    this.database.prepare(
      `INSERT INTO memories(
         id, user_id, domain, memory_type, content, entities_json,
         source_message_id, source, confidence, importance, sensitivity,
         valid_from, valid_until, last_confirmed_at, status, created_at,
         updated_at, source_excerpt, memory_key, merge_count
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         domain = excluded.domain,
         memory_type = excluded.memory_type,
         content = excluded.content,
         entities_json = excluded.entities_json,
         source_message_id = excluded.source_message_id,
         source = excluded.source,
         confidence = excluded.confidence,
         importance = excluded.importance,
         sensitivity = excluded.sensitivity,
         valid_from = excluded.valid_from,
         valid_until = excluded.valid_until,
         last_confirmed_at = excluded.last_confirmed_at,
         status = excluded.status,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at,
         source_excerpt = excluded.source_excerpt,
         memory_key = excluded.memory_key,
         merge_count = excluded.merge_count`
    ).run(
      operation.entityId,
      userId,
      requiredText(payload.domain, "domain", 60),
      requiredText(payload.memory_type, "memory_type", 60),
      content,
      JSON.stringify(entities),
      nullableText(payload.source_message_id, "source_message_id", 200),
      enumValue(payload.source, "source", ["explicit", "inferred", "imported"]),
      unitInterval(payload.confidence, "confidence"),
      unitInterval(payload.importance, "importance"),
      enumValue(payload.sensitivity, "sensitivity", ["normal", "personal", "sensitive"]),
      nullableSafeInteger(payload.valid_from, "valid_from"),
      nullableSafeInteger(payload.valid_until, "valid_until"),
      nullableSafeInteger(payload.last_confirmed_at, "last_confirmed_at"),
      enumValue(payload.status, "status", ["candidate", "active", "archived"]),
      safeInteger(payload.created_at, "created_at"),
      safeInteger(payload.updated_at, "updated_at"),
      text(payload.source_excerpt, "source_excerpt", 500),
      text(payload.memory_key, "memory_key", 200),
      positiveSafeInteger(payload.merge_count, "merge_count")
    );
    if (this.hasMemoryFts()) {
      this.database.prepare("DELETE FROM memories_fts WHERE memory_id = ?")
        .run(operation.entityId);
      this.database.prepare(
        `INSERT INTO memories_fts(memory_id, user_id, content, entities)
         VALUES (?, ?, ?, ?)`
      ).run(operation.entityId, userId, content, entities.join(" "));
    }
  }

  applyMemoryEvidence(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("memory_evidence", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database.prepare("DELETE FROM memory_evidence WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const memoryId = requiredText(payload.memory_id, "memory_id", 200);
    const parent = this.database.prepare("SELECT user_id FROM memories WHERE id = ?")
      .get(memoryId);
    if (!parent || parent.user_id !== userId) {
      throw new HttpError(409, "REPLICATION_MEMORY_MISSING", "记忆证据引用的长期记忆不存在。");
    }
    const evidenceHash = requiredText(payload.evidence_hash, "evidence_hash", 64);
    if (!/^[a-f0-9]{64}$/.test(evidenceHash)) {
      invalidPayload("evidence_hash", "记忆证据摘要无效。");
    }
    const logicalOwner = this.database.prepare(
      `SELECT id FROM memory_evidence
       WHERE user_id = ? AND memory_id = ? AND evidence_hash = ?`
    ).get(userId, memoryId, evidenceHash);
    if (logicalOwner && logicalOwner.id !== operation.entityId) {
      throw new HttpError(409, "REPLICATION_ENTITY_ID_CONFLICT", "相同记忆证据对应了不同实体 ID。");
    }
    this.database.prepare(
      `INSERT INTO memory_evidence(
         id, user_id, memory_id, conversation_id, evidence,
         evidence_hash, confidence, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         memory_id = excluded.memory_id,
         conversation_id = excluded.conversation_id,
         evidence = excluded.evidence,
         evidence_hash = excluded.evidence_hash,
         confidence = excluded.confidence,
         created_at = excluded.created_at`
    ).run(
      operation.entityId,
      userId,
      memoryId,
      text(payload.conversation_id, "conversation_id", 100),
      requiredText(payload.evidence, "evidence", 1000),
      evidenceHash,
      unitInterval(payload.confidence, "confidence"),
      safeInteger(payload.created_at, "created_at")
    );
  }

  applyMemorySettings(userId, operation) {
    if (operation.entityId !== "settings") {
      invalidPayload("entityId", "记忆设置只能使用固定逻辑实体 settings。");
    }
    requireUpsert(operation);
    const payload = operation.payload;
    this.database.prepare(
      `INSERT INTO memory_settings(user_id, auto_confirm, auto_confirm_all, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         auto_confirm = excluded.auto_confirm,
         auto_confirm_all = excluded.auto_confirm_all,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      boolean(payload.auto_confirm, "auto_confirm") ? 1 : 0,
      boolean(payload.auto_confirm_all, "auto_confirm_all") ? 1 : 0,
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyPromptSettings(userId, operation) {
    if (operation.entityId !== "settings") {
      invalidPayload("entityId", "提示词设置只能使用固定逻辑实体 settings。");
    }
    requireUpsert(operation);
    const payload = operation.payload;
    const settings = jsonObject(payload.settings, "settings", 200_000);
    this.database.prepare(
      `INSERT INTO prompt_settings(user_id, version, settings_json, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         version = excluded.version,
         settings_json = excluded.settings_json,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      positiveSafeInteger(payload.version, "version"),
      canonicalStringify(settings),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyPromptSettingVersion(userId, operation) {
    const payload = operation.payload;
    requireMatchingId(payload.id, operation.entityId);
    this.assertOwnership("prompt_setting_versions", userId, operation.entityId);
    requireUpsert(operation);
    const version = positiveSafeInteger(payload.version, "version");
    const logicalOwner = this.database.prepare(
      `SELECT id FROM prompt_setting_versions
       WHERE user_id = ? AND version = ?`
    ).get(userId, version);
    if (logicalOwner && logicalOwner.id !== operation.entityId) {
      throw new HttpError(
        409,
        "REPLICATION_ENTITY_ID_CONFLICT",
        "同一提示词版本在本地对应了不同实体 ID。"
      );
    }
    const settings = jsonObject(payload.settings, "settings", 200_000);
    this.database.prepare(
      `INSERT INTO prompt_setting_versions(
         id, user_id, version, settings_json, created_at
       ) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         version = excluded.version,
         settings_json = excluded.settings_json,
         created_at = excluded.created_at`
    ).run(
      operation.entityId,
      userId,
      version,
      canonicalStringify(settings),
      safeInteger(payload.created_at, "created_at")
    );
  }

  applyModuleSetting(userId, operation) {
    requireUpsert(operation);
    const payload = operation.payload;
    const moduleId = requiredText(payload.module_id, "module_id", 200);
    if (moduleId !== operation.entityId) {
      invalidPayload("module_id", "模块设置主键与 Operation 实体主键不一致。");
    }
    this.database.prepare(
      `INSERT INTO module_settings(user_id, module_id, enabled, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, module_id) DO UPDATE SET
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      moduleId,
      boolean(payload.enabled, "enabled") ? 1 : 0,
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyAssistantProfile(userId, operation) {
    if (operation.entityId !== "profile") {
      invalidPayload("entityId", "AI 人格画像只能使用固定逻辑实体 profile。");
    }
    requireUpsert(operation);
    const payload = operation.payload;
    const traits = jsonArray(payload.traits, "traits", 30, 100_000);
    const values = jsonArray(payload.values, "values", 30, 100_000);
    this.database.prepare(
      `INSERT INTO assistant_profiles(
         user_id, name, gender, self_definition, relationship_summary,
         traits_json, values_json, avatar_data_url, persona_image_data_url, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         name = excluded.name,
         gender = excluded.gender,
         self_definition = excluded.self_definition,
         relationship_summary = excluded.relationship_summary,
         traits_json = excluded.traits_json,
         values_json = excluded.values_json,
         avatar_data_url = excluded.avatar_data_url,
         persona_image_data_url = excluded.persona_image_data_url,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      text(payload.name, "name", 100),
      text(payload.gender, "gender", 50),
      text(payload.self_definition, "self_definition", 1000),
      text(payload.relationship_summary, "relationship_summary", 1000),
      canonicalStringify(traits),
      canonicalStringify(values),
      normalizeAvatarDataUrl(payload.avatar_data_url),
      normalizePersonaImageDataUrl(payload.persona_image_data_url),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyPersonalityEvent(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("assistant_personality_events", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database.prepare(
        "DELETE FROM assistant_personality_events WHERE user_id = ? AND id = ?"
      ).run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    this.database.prepare(
      `INSERT INTO assistant_personality_events(
         id, user_id, category, trait_key, trait_value, content, evidence,
         source_role, confidence, weight, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         category = excluded.category,
         trait_key = excluded.trait_key,
         trait_value = excluded.trait_value,
         content = excluded.content,
         evidence = excluded.evidence,
         source_role = excluded.source_role,
         confidence = excluded.confidence,
         weight = excluded.weight,
         status = excluded.status,
         created_at = excluded.created_at`
    ).run(
      operation.entityId,
      userId,
      requiredText(payload.category, "category", 60),
      text(payload.trait_key, "trait_key", 100),
      text(payload.trait_value, "trait_value", 500),
      requiredText(payload.content, "content", 2000),
      text(payload.evidence, "evidence", 1000),
      enumValue(payload.source_role, "source_role", ["user", "assistant", "tool", "shared"]),
      unitInterval(payload.confidence, "confidence"),
      unitInterval(payload.weight, "weight"),
      enumValue(payload.status, "status", ["candidate", "active"]),
      safeInteger(payload.created_at, "created_at")
    );
  }

  applySharedMemory(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("shared_memories", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database.prepare("DELETE FROM shared_memories WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const participants = stringArray(payload.participants, "participants", 20, 100);
    this.database.prepare(
      `INSERT INTO shared_memories(
         id, user_id, memory_type, content, participants_json, evidence,
         source, confidence, importance, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         memory_type = excluded.memory_type,
         content = excluded.content,
         participants_json = excluded.participants_json,
         evidence = excluded.evidence,
         source = excluded.source,
         confidence = excluded.confidence,
         importance = excluded.importance,
         status = excluded.status,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      operation.entityId,
      userId,
      requiredText(payload.memory_type, "memory_type", 60),
      requiredText(payload.content, "content", 5000),
      JSON.stringify(participants),
      text(payload.evidence, "evidence", 1000),
      enumValue(payload.source, "source", ["explicit", "inferred", "tool"]),
      unitInterval(payload.confidence, "confidence"),
      unitInterval(payload.importance, "importance"),
      enumValue(payload.status, "status", ["candidate", "active"]),
      safeInteger(payload.created_at, "created_at"),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyJournal(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("assistant_journals", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database.prepare("DELETE FROM assistant_journals WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const journalType = enumValue(payload.journal_type, "journal_type", ["daily", "weekly"]);
    const periodKey = requiredText(payload.period_key, "period_key", 20);
    if (!/^\d{4}-(?:\d{2}-\d{2}|W\d{2})$/.test(periodKey)) {
      invalidPayload("period_key", "手记周期格式不正确。");
    }
    const sourceFrom = safeInteger(payload.source_from, "source_from");
    const sourceTo = safeInteger(payload.source_to, "source_to");
    if (sourceTo <= sourceFrom || sourceTo - sourceFrom > 9 * 86400_000) {
      invalidPayload("source_to", "手记素材周期不正确。");
    }
    this.database.prepare(
      `INSERT INTO assistant_journals(
         id, user_id, journal_type, period_key, title, content, mood,
         source_from, source_to, source_message_count, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         journal_type = excluded.journal_type,
         period_key = excluded.period_key,
         title = excluded.title,
         content = excluded.content,
         mood = excluded.mood,
         source_from = excluded.source_from,
         source_to = excluded.source_to,
         source_message_count = excluded.source_message_count,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      operation.entityId,
      userId,
      journalType,
      periodKey,
      requiredText(payload.title, "title", 200),
      requiredText(payload.content, "content", 12_000_000),
      text(payload.mood, "mood", 100),
      sourceFrom,
      sourceTo,
      safeInteger(payload.source_message_count, "source_message_count"),
      safeInteger(payload.created_at, "created_at"),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyMoodEvent(userId, operation) {
    const payload = operation.payload;
    requireMatchingId(payload.id, operation.entityId);
    this.assertOwnership("xuan_mood_events", userId, operation.entityId);
    requireUpsert(operation);
    const rawPayload = jsonObject(payload.raw_payload, "raw_payload", 200_000);
    this.database.prepare(
      `INSERT INTO xuan_mood_events(
         id, user_id, source_type, source_id, source_created_at, summary,
         emotional_tone, effect_on_xuan, intensity, raw_payload_json, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         source_type = excluded.source_type,
         source_id = excluded.source_id,
         source_created_at = excluded.source_created_at,
         summary = excluded.summary,
         emotional_tone = excluded.emotional_tone,
         effect_on_xuan = excluded.effect_on_xuan,
         intensity = excluded.intensity,
         raw_payload_json = excluded.raw_payload_json,
         created_at = excluded.created_at`
    ).run(
      operation.entityId,
      userId,
      enumValue(payload.source_type, "source_type", [
        "chat",
        "journal",
        "shared_experience"
      ]),
      text(payload.source_id, "source_id", 120),
      safeInteger(payload.source_created_at, "source_created_at"),
      requiredText(payload.summary, "summary", 500),
      text(payload.emotional_tone, "emotional_tone", 120),
      text(payload.effect_on_xuan, "effect_on_xuan", 500),
      enumValue(payload.intensity, "intensity", ["low", "medium", "high"]),
      canonicalStringify(rawPayload),
      safeInteger(payload.created_at, "created_at")
    );
  }

  applyMoodState(userId, operation) {
    if (operation.entityId !== "state") {
      invalidPayload("entityId", "心情状态只能使用固定逻辑实体 state。");
    }
    requireUpsert(operation);
    const state = jsonObject(operation.payload.state, "state", 200_000);
    this.database.prepare(
      `INSERT INTO xuan_mood_state(user_id, state_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         state_json = excluded.state_json,
         updated_at = excluded.updated_at`
    ).run(
      userId,
      canonicalStringify(state),
      safeInteger(operation.payload.updated_at, "updated_at")
    );
  }

  applyMoodDisplay(userId, operation) {
    const payload = operation.payload;
    requireMatchingId(payload.id, operation.entityId);
    this.assertOwnership("xuan_mood_displays", userId, operation.entityId);
    requireUpsert(operation);
    const eventIds = stringArray(
      payload.based_on_event_ids,
      "based_on_event_ids",
      20,
      200
    );
    this.database.prepare(
      `INSERT INTO xuan_mood_displays(
         id, user_id, title, line, detail, focus, tone,
         based_on_event_ids_json, expires_at, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         title = excluded.title,
         line = excluded.line,
         detail = excluded.detail,
         focus = excluded.focus,
         tone = excluded.tone,
         based_on_event_ids_json = excluded.based_on_event_ids_json,
         expires_at = excluded.expires_at,
         created_at = excluded.created_at`
    ).run(
      operation.entityId,
      userId,
      requiredText(payload.title, "title", 24),
      requiredText(payload.line, "line", 180),
      text(payload.detail, "detail", 600),
      text(payload.focus, "focus", 120),
      enumValue(payload.tone, "tone", [
        "calm",
        "clingy",
        "focused",
        "tired",
        "happy",
        "worried",
        "quiet"
      ]),
      canonicalStringify(eventIds),
      safeInteger(payload.expires_at, "expires_at"),
      safeInteger(payload.created_at, "created_at")
    );
  }

  applyAlbumMoment(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("album_moments", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database.prepare("DELETE FROM album_moments WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const tags = stringArray(payload.tags, "tags", 12, 30);
    this.database.prepare(
      `INSERT INTO album_moments(
         id, user_id, occurred_at, title, summary, detail, mood,
         tags_json, importance, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         occurred_at = excluded.occurred_at,
         title = excluded.title,
         summary = excluded.summary,
         detail = excluded.detail,
         mood = excluded.mood,
         tags_json = excluded.tags_json,
         importance = excluded.importance,
         status = excluded.status,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      operation.entityId,
      userId,
      safeInteger(payload.occurred_at, "occurred_at"),
      requiredText(payload.title, "title", 80),
      requiredText(payload.summary, "summary", 500),
      text(payload.detail, "detail", 5000),
      text(payload.mood, "mood", 80),
      canonicalStringify(tags),
      unitInterval(payload.importance, "importance"),
      enumValue(payload.status, "status", ["candidate", "active", "hidden", "all"]),
      safeInteger(payload.created_at, "created_at"),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyAlbumSource(userId, operation) {
    return this.applyDependentSource(userId, operation, {
      table: "album_moment_sources",
      parentTable: "album_moments",
      parentField: "moment_id",
      parentPayloadField: "moment_id",
      sourceTypes: [
        "shared_memory",
        "journal",
        "mood_event",
        "conversation_message",
        "memory",
        "manual"
      ]
    });
  }

  applyDream(userId, operation) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership("assistant_dreams", userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database.prepare("DELETE FROM assistant_dreams WHERE user_id = ? AND id = ?")
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const dreamDate = requiredText(payload.dream_date, "dream_date", 20);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dreamDate)) {
      invalidPayload("dream_date", "梦境日期格式不正确。");
    }
    const symbols = stringArray(payload.symbols, "symbols", 16, 30);
    const sourceFrom = safeInteger(payload.source_from, "source_from");
    const sourceTo = safeInteger(payload.source_to, "source_to");
    if (sourceTo <= sourceFrom || sourceTo - sourceFrom > 9 * 86400_000) {
      invalidPayload("source_to", "梦境素材周期不正确。");
    }
    this.database.prepare(
      `INSERT INTO assistant_dreams(
         id, user_id, dream_date, title, content, mood, symbols_json,
         reality_note, source_from, source_to, status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         user_id = excluded.user_id,
         dream_date = excluded.dream_date,
         title = excluded.title,
         content = excluded.content,
         mood = excluded.mood,
         symbols_json = excluded.symbols_json,
         reality_note = excluded.reality_note,
         source_from = excluded.source_from,
         source_to = excluded.source_to,
         status = excluded.status,
         created_at = excluded.created_at,
         updated_at = excluded.updated_at`
    ).run(
      operation.entityId,
      userId,
      dreamDate,
      requiredText(payload.title, "title", 100),
      requiredText(payload.content, "content", 20_000),
      text(payload.mood, "mood", 100),
      canonicalStringify(symbols),
      requiredText(payload.reality_note, "reality_note", 300),
      sourceFrom,
      sourceTo,
      enumValue(payload.status, "status", ["active", "archived"]),
      safeInteger(payload.created_at, "created_at"),
      safeInteger(payload.updated_at, "updated_at")
    );
  }

  applyDreamSource(userId, operation) {
    return this.applyDependentSource(userId, operation, {
      table: "assistant_dream_sources",
      parentTable: "assistant_dreams",
      parentField: "dream_id",
      parentPayloadField: "dream_id",
      sourceTypes: [
        "chat",
        "journal",
        "memory",
        "shared_memory",
        "mood_event",
        "manual"
      ]
    });
  }

  applyDependentSource(userId, operation, options) {
    const payload = operation.payload;
    requireOptionalMatchingId(payload.id, operation.entityId, operation.operation);
    this.assertOwnership(options.table, userId, operation.entityId);
    if (operation.operation === "delete") {
      this.database.prepare(`DELETE FROM ${options.table} WHERE user_id = ? AND id = ?`)
        .run(userId, operation.entityId);
      return;
    }
    requireUpsert(operation);
    const parentId = requiredText(
      payload[options.parentPayloadField],
      options.parentPayloadField,
      200
    );
    const parent = this.database.prepare(
      `SELECT user_id FROM ${options.parentTable} WHERE id = ?`
    ).get(parentId);
    if (!parent || parent.user_id !== userId) {
      throw new HttpError(
        409,
        "REPLICATION_PARENT_MISSING",
        "扩展内容来源引用的父实体不存在。"
      );
    }
    const sourceType = enumValue(
      payload.source_type,
      "source_type",
      options.sourceTypes
    );
    const sourceId = requiredText(payload.source_id, "source_id", 200);
    const logicalOwner = this.database.prepare(
      `SELECT id FROM ${options.table}
       WHERE ${options.parentField} = ? AND source_type = ? AND source_id = ?`
    ).get(parentId, sourceType, sourceId);
    if (logicalOwner && logicalOwner.id !== operation.entityId) {
      throw new HttpError(
        409,
        "REPLICATION_ENTITY_ID_CONFLICT",
        "相同扩展内容来源对应了不同实体 ID。"
      );
    }
    this.database.prepare(
      `INSERT INTO ${options.table}(
         id, ${options.parentField}, user_id, source_type, source_id,
         source_excerpt, weight, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         ${options.parentField} = excluded.${options.parentField},
         user_id = excluded.user_id,
         source_type = excluded.source_type,
         source_id = excluded.source_id,
         source_excerpt = excluded.source_excerpt,
         weight = excluded.weight,
         created_at = excluded.created_at`
    ).run(
      operation.entityId,
      parentId,
      userId,
      sourceType,
      sourceId,
      text(payload.source_excerpt, "source_excerpt", 1200),
      unitInterval(payload.weight, "weight"),
      safeInteger(payload.created_at, "created_at")
    );
  }

  hasMemoryFts() {
    return Boolean(this.database.prepare(
      "SELECT 1 FROM sqlite_schema WHERE name = 'memories_fts' LIMIT 1"
    ).get());
  }

  assertOwnership(table, userId, entityId) {
    const row = this.database
      .prepare(`SELECT user_id FROM ${table} WHERE id = ?`)
      .get(entityId);
    if (row && row.user_id !== userId) {
      throw new HttpError(
        409,
        "REPLICATION_ENTITY_OWNERSHIP_CONFLICT",
        "实体 ID 已经属于另一个本地账号。"
      );
    }
  }
}

function requireUpsert(operation) {
  if (operation.operation !== "upsert") {
    invalidPayload("operation", "试点实体只支持 upsert 和 delete Operation。");
  }
}

function requireMatchingId(value, expected) {
  if (value !== expected) invalidPayload("id", "Payload 主键与 Operation 实体主键不一致。");
}

function requireOptionalMatchingId(value, expected, operation) {
  if (operation === "delete" && value === undefined) return;
  requireMatchingId(value, expected);
}

function requiredText(value, field, maxLength) {
  const result = text(value, field, maxLength);
  if (!result.trim()) invalidPayload(field, `${field} 不能为空。`);
  return result;
}

function text(value, field, maxLength) {
  if (typeof value !== "string" || value.length > maxLength) {
    invalidPayload(field, `${field} 不是有效文本。`);
  }
  return value;
}

function safeInteger(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    invalidPayload(field, `${field} 必须是非负安全整数。`);
  }
  return result;
}

function nullableText(value, field, maxLength) {
  if (value === null) return null;
  return text(value, field, maxLength);
}

function nullableSafeInteger(value, field) {
  if (value === null) return null;
  return safeInteger(value, field);
}

function positiveSafeInteger(value, field) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) {
    invalidPayload(field, `${field} must be a positive safe integer.`);
  }
  return result;
}

function unitInterval(value, field) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 1) {
    invalidPayload(field, `${field} must be between 0 and 1.`);
  }
  return result;
}

function boolean(value, field) {
  if (typeof value !== "boolean") invalidPayload(field, `${field} 必须是布尔值。`);
  return value;
}

function stringArray(value, field, maxItems, maxLength) {
  if (!Array.isArray(value) || value.length > maxItems) {
    invalidPayload(field, `${field} 不是有效数组。`);
  }
  return value.map((item) => text(item, field, maxLength));
}

function jsonArray(value, field, maxItems, maxBytes) {
  if (!Array.isArray(value) || value.length > maxItems) {
    invalidPayload(field, `${field} must be a valid array.`);
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    invalidPayload(field, `${field} exceeds the allowed size.`);
  }
  return value;
}

function enumValue(value, field, allowed) {
  if (!allowed.includes(value)) invalidPayload(field, `${field} 使用了不支持的值。`);
  return value;
}

function walletCurrency(value, field) {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) {
    invalidPayload(field, `${field} 必须是三个大写字母组成的币种代码。`);
  }
  return value;
}

function walletMinor(value, field) {
  const result = Number(value);
  if (
    !Number.isSafeInteger(result) ||
    result < 0 ||
    result > MAX_WALLET_BALANCE_MINOR
  ) {
    invalidPayload(field, `${field} 不是有效的钱包整数分金额。`);
  }
  return result;
}

function nullableWalletMinor(value, field) {
  if (value === null) return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_WALLET_BALANCE_MINOR) {
    invalidPayload(field, `${field} 不是有效的钱包整数分变化量。`);
  }
  return result;
}

function jsonObject(value, field, maxBytes) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidPayload(field, `${field} 必须是 JSON 对象。`);
  }
  const encoded = JSON.stringify(value);
  if (Buffer.byteLength(encoded, "utf8") > maxBytes) {
    invalidPayload(field, `${field} 超出允许大小。`);
  }
  return value;
}

function invalidPayload(field, message) {
  throw new HttpError(400, "REPLICATION_PAYLOAD_INVALID", message, { field });
}

module.exports = { ReplicationEntityApplier, SUPPORTED_ENTITY_TYPES };
