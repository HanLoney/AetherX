import { ApiError } from "./api";

export interface LocalMutationInput {
  entityType: string;
  entityId: string;
  operation?: "upsert" | "delete";
  payload?: Record<string, unknown>;
  documentPayload?: Record<string, unknown>;
}

const MAX_WALLET_BALANCE_MINOR = 100_000_000_000_000;
const ALBUM_SOURCE_TYPES = ["shared_memory", "journal", "mood_event", "conversation_message", "memory", "manual"] as const;
const DREAM_SOURCE_TYPES = ["chat", "journal", "memory", "shared_memory", "mood_event", "manual"] as const;

export function validateLocalMutation(mutation: LocalMutationInput) {
  const entityType = requiredText(mutation.entityType, "entityType", 200);
  const entityId = requiredText(mutation.entityId, "entityId", 200);
  const operation = mutation.operation || "upsert";
  if (operation !== "upsert" && operation !== "delete") invalid("operation", "本地写入操作无效。");
  const payload = object(mutation.payload, "payload");

  if (payload.id !== undefined) matchingId(payload.id, entityId);
  if (operation === "delete") return;

  switch (entityType) {
    case "todos":
      matchingId(payload.id, entityId);
      requiredText(payload.text, "text", 1000);
      if (safeInteger(payload.end_at, "end_at") <= safeInteger(payload.start_at, "start_at")) {
        invalid("end_at", "待办结束时间必须晚于开始时间。");
      }
      boolean(payload.completed, "completed");
      timestamps(payload);
      return;
    case "user_profiles":
      fixedId(entityId, "profile");
      text(payload.display_name, "display_name", 100);
      text(payload.preferred_name, "preferred_name", 100);
      text(payload.birthday, "birthday", 10);
      text(payload.bio, "bio", 2000);
      text(payload.occupation, "occupation", 200);
      stringArray(payload.goals, "goals", 30, 500);
      imageDataUrl(payload.avatar_data_url, "avatar_data_url", 700 * 1024);
      safeInteger(payload.updated_at, "updated_at");
      return;
    case "assistant_profiles":
      fixedId(entityId, "profile");
      text(payload.name, "name", 100);
      text(payload.gender, "gender", 50);
      text(payload.self_definition, "self_definition", 1000);
      text(payload.relationship_summary, "relationship_summary", 1000);
      jsonArray(payload.traits, "traits", 30, 100_000);
      jsonArray(payload.values, "values", 30, 100_000);
      imageDataUrl(payload.avatar_data_url, "avatar_data_url", 700 * 1024);
      imageDataUrl(payload.persona_image_data_url, "persona_image_data_url", 4 * 1024 * 1024);
      safeInteger(payload.updated_at, "updated_at");
      return;
    case "user_preferences":
      matchingId(payload.id, entityId);
      requiredText(payload.category, "category", 60);
      requiredText(payload.preference_key, "preference_key", 100);
      jsonSize(payload.value, "value", 200_000);
      enumValue(payload.source, "source", ["explicit", "inferred"]);
      unitInterval(payload.confidence, "confidence");
      enumValue(payload.sensitivity, "sensitivity", ["normal", "personal", "sensitive"]);
      timestamps(payload);
      return;
    case "wallet_accounts":
      matchingId(payload.id, entityId);
      requiredText(payload.name, "name", 60);
      walletMinor(payload.balance_minor, "balance_minor");
      walletCurrency(payload.currency, "currency");
      text(payload.note, "note", 240);
      timestamps(payload);
      return;
    case "wallet_transactions": {
      matchingId(payload.id, entityId);
      requiredText(payload.account_id, "account_id", 200);
      const eventType = enumValue(payload.event_type, "event_type", ["create", "deposit", "withdrawal", "set", "edit"]);
      const change = nullableWalletChange(payload.change_minor, "change_minor");
      const before = walletMinor(payload.balance_before_minor, "balance_before_minor");
      const after = walletMinor(payload.balance_after_minor, "balance_after_minor");
      if (change !== null && before + change !== after) invalid("change_minor", "钱包流水的金额变化与前后余额不一致。");
      if (eventType === "deposit" && !(change !== null && change > 0)) invalid("change_minor", "收入流水必须是正数。");
      if (eventType === "withdrawal" && !(change !== null && change < 0)) invalid("change_minor", "支出流水必须是负数。");
      if (eventType === "create" && (before !== 0 || change !== after)) invalid("event_type", "期初余额流水不一致。");
      walletCurrency(payload.previous_currency, "previous_currency");
      walletCurrency(payload.currency, "currency");
      text(payload.detail, "detail", 160);
      enumValue(payload.source, "source", ["manual", "chat"]);
      safeInteger(payload.created_at, "created_at");
      return;
    }
    case "conversations":
      matchingId(payload.id, entityId);
      requiredText(payload.title, "title", 120);
      text(payload.summary, "summary", 5000);
      timestamps(payload);
      return;
    case "messages":
      matchingId(payload.id, entityId);
      requiredText(payload.conversation_id, "conversation_id", 200);
      enumValue(payload.stream_type, "stream_type", ["display", "model"]);
      safeInteger(payload.position, "position");
      text(payload.role, "role", 40);
      if (payload.content !== null) text(payload.content, "content", 100_000);
      jsonObject(payload.payload, "payload", 1_000_000);
      safeInteger(payload.created_at, "created_at");
      return;
    case "memories":
      matchingId(payload.id, entityId);
      requiredText(payload.domain, "domain", 60);
      requiredText(payload.memory_type, "memory_type", 60);
      requiredText(payload.content, "content", 5000);
      stringArray(payload.entities, "entities", 30, 500);
      nullableText(payload.source_message_id, "source_message_id", 200);
      enumValue(payload.source, "source", ["explicit", "inferred", "imported"]);
      unitInterval(payload.confidence, "confidence");
      unitInterval(payload.importance, "importance");
      enumValue(payload.sensitivity, "sensitivity", ["normal", "personal", "sensitive"]);
      nullableSafeInteger(payload.valid_from, "valid_from");
      nullableSafeInteger(payload.valid_until, "valid_until");
      nullableSafeInteger(payload.last_confirmed_at, "last_confirmed_at");
      enumValue(payload.status, "status", ["candidate", "active", "archived"]);
      timestamps(payload);
      text(payload.source_excerpt, "source_excerpt", 500);
      text(payload.memory_key, "memory_key", 200);
      positiveSafeInteger(payload.merge_count, "merge_count");
      return;
    case "memory_evidence":
      matchingId(payload.id, entityId);
      requiredText(payload.memory_id, "memory_id", 200);
      text(payload.conversation_id, "conversation_id", 100);
      requiredText(payload.evidence, "evidence", 1000);
      hash(payload.evidence_hash, "evidence_hash");
      unitInterval(payload.confidence, "confidence");
      safeInteger(payload.created_at, "created_at");
      return;
    case "module_settings":
      if (requiredText(payload.module_id, "module_id", 200) !== entityId) invalid("module_id", "模块设置主键不一致。");
      boolean(payload.enabled, "enabled");
      safeInteger(payload.updated_at, "updated_at");
      return;
    case "assistant_personality_events":
      matchingId(payload.id, entityId);
      requiredText(payload.category, "category", 60);
      text(payload.trait_key, "trait_key", 100);
      text(payload.trait_value, "trait_value", 500);
      requiredText(payload.content, "content", 2000);
      text(payload.evidence, "evidence", 1000);
      enumValue(payload.source_role, "source_role", ["user", "assistant", "tool", "shared"]);
      unitInterval(payload.confidence, "confidence");
      unitInterval(payload.weight, "weight");
      enumValue(payload.status, "status", ["candidate", "active"]);
      safeInteger(payload.created_at, "created_at");
      return;
    case "shared_memories":
      matchingId(payload.id, entityId);
      requiredText(payload.memory_type, "memory_type", 60);
      requiredText(payload.content, "content", 5000);
      stringArray(payload.participants, "participants", 20, 100);
      text(payload.evidence, "evidence", 1000);
      enumValue(payload.source, "source", ["explicit", "inferred", "tool"]);
      unitInterval(payload.confidence, "confidence");
      unitInterval(payload.importance, "importance");
      enumValue(payload.status, "status", ["candidate", "active"]);
      timestamps(payload);
      return;
    case "assistant_journals": {
      matchingId(payload.id, entityId);
      enumValue(payload.journal_type, "journal_type", ["daily", "weekly"]);
      const period = requiredText(payload.period_key, "period_key", 20);
      if (!/^\d{4}-(?:\d{2}-\d{2}|W\d{2})$/.test(period)) invalid("period_key", "手记周期格式不正确。");
      requiredText(payload.title, "title", 200);
      requiredText(payload.content, "content", 12_000_000);
      text(payload.mood, "mood", 100);
      validateSourceRange(payload);
      safeInteger(payload.source_message_count, "source_message_count");
      timestamps(payload);
      return;
    }
    case "xuan_mood_events":
      matchingId(payload.id, entityId);
      enumValue(payload.source_type, "source_type", ["chat", "journal", "shared_experience"]);
      text(payload.source_id, "source_id", 120);
      safeInteger(payload.source_created_at, "source_created_at");
      requiredText(payload.summary, "summary", 500);
      text(payload.emotional_tone, "emotional_tone", 120);
      text(payload.effect_on_xuan, "effect_on_xuan", 500);
      enumValue(payload.intensity, "intensity", ["low", "medium", "high"]);
      jsonObject(payload.raw_payload, "raw_payload", 200_000);
      safeInteger(payload.created_at, "created_at");
      return;
    case "xuan_mood_state":
      fixedId(entityId, "state");
      jsonObject(payload.state, "state", 200_000);
      safeInteger(payload.updated_at, "updated_at");
      return;
    case "xuan_mood_displays":
      matchingId(payload.id, entityId);
      requiredText(payload.title, "title", 24);
      requiredText(payload.line, "line", 180);
      text(payload.detail, "detail", 600);
      text(payload.focus, "focus", 120);
      enumValue(payload.tone, "tone", ["calm", "clingy", "focused", "tired", "happy", "worried", "quiet"]);
      stringArray(payload.based_on_event_ids, "based_on_event_ids", 20, 200);
      safeInteger(payload.expires_at, "expires_at");
      safeInteger(payload.created_at, "created_at");
      return;
    case "album_moments":
      matchingId(payload.id, entityId);
      safeInteger(payload.occurred_at, "occurred_at");
      requiredText(payload.title, "title", 80);
      requiredText(payload.summary, "summary", 500);
      text(payload.detail, "detail", 5000);
      text(payload.mood, "mood", 80);
      stringArray(payload.tags, "tags", 12, 30);
      unitInterval(payload.importance, "importance");
      enumValue(payload.status, "status", ["candidate", "active", "hidden", "all"]);
      timestamps(payload);
      return;
    case "album_moment_sources":
      validateSource(payload, entityId, "moment_id", ALBUM_SOURCE_TYPES);
      return;
    case "assistant_dreams": {
      matchingId(payload.id, entityId);
      const dreamDate = requiredText(payload.dream_date, "dream_date", 20);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dreamDate)) invalid("dream_date", "梦境日期格式不正确。");
      requiredText(payload.title, "title", 100);
      requiredText(payload.content, "content", 20_000);
      text(payload.mood, "mood", 100);
      stringArray(payload.symbols, "symbols", 16, 30);
      requiredText(payload.reality_note, "reality_note", 300);
      validateSourceRange(payload);
      enumValue(payload.status, "status", ["active", "archived"]);
      timestamps(payload);
      return;
    }
    case "assistant_dream_sources":
      validateSource(payload, entityId, "dream_id", DREAM_SOURCE_TYPES);
      return;
    case "media_assets":
      matchingId(payload.id, entityId);
      enumValue(payload.mime_type, "mime_type", ["image/png", "image/jpeg", "image/webp", "image/gif"]);
      mediaFileName(payload.file_name);
      positiveSafeInteger(payload.byte_size, "byte_size");
      hash(payload.content_hash, "content_hash");
      safeInteger(payload.created_at, "created_at");
      return;
    default:
      invalid("entityType", `Android Local Hub 尚未声明 ${entityType} 的写入模型。`);
  }
}

export function validateLocalMutations(mutations: LocalMutationInput[]) {
  if (!Array.isArray(mutations) || mutations.length < 1 || mutations.length > 500) {
    invalid("mutations", "本地事务必须包含 1 到 500 条写入。");
  }
  mutations.forEach(validateLocalMutation);
}

function validateSource(payload: Record<string, unknown>, entityId: string, parentField: string, sourceTypes: readonly string[]) {
  matchingId(payload.id, entityId);
  requiredText(payload[parentField], parentField, 200);
  enumValue(payload.source_type, "source_type", sourceTypes);
  requiredText(payload.source_id, "source_id", 200);
  text(payload.source_excerpt, "source_excerpt", 1200);
  unitInterval(payload.weight, "weight");
  safeInteger(payload.created_at, "created_at");
}

function validateSourceRange(payload: Record<string, unknown>) {
  const from = safeInteger(payload.source_from, "source_from");
  const to = safeInteger(payload.source_to, "source_to");
  if (to <= from || to - from > 9 * 86_400_000) invalid("source_to", "素材时间范围不正确。");
}

function timestamps(payload: Record<string, unknown>) {
  safeInteger(payload.created_at, "created_at");
  safeInteger(payload.updated_at, "updated_at");
}

function fixedId(value: string, expected: string) {
  if (value !== expected) invalid("entityId", `实体主键必须是 ${expected}。`);
}

function matchingId(value: unknown, expected: string) {
  if (value !== expected) invalid("id", "Payload 主键与实体主键不一致。");
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid(field, `${field} 必须是对象。`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, field: string, maxLength: number) {
  const result = text(value, field, maxLength);
  if (!result.trim()) invalid(field, `${field} 不能为空。`);
  return result;
}

function text(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || value.length > maxLength) invalid(field, `${field} 不是有效文本。`);
  return value as string;
}

function nullableText(value: unknown, field: string, maxLength: number) {
  if (value === null) return null;
  return text(value, field, maxLength);
}

function safeInteger(value: unknown, field: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) invalid(field, `${field} 必须是非负安全整数。`);
  return result;
}

function positiveSafeInteger(value: unknown, field: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) invalid(field, `${field} 必须是正安全整数。`);
  return result;
}

function nullableSafeInteger(value: unknown, field: string) {
  if (value === null) return null;
  return safeInteger(value, field);
}

function boolean(value: unknown, field: string) {
  if (typeof value !== "boolean") invalid(field, `${field} 必须是布尔值。`);
  return value as boolean;
}

function unitInterval(value: unknown, field: string) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 1) invalid(field, `${field} 必须在 0 到 1 之间。`);
  return result;
}

function stringArray(value: unknown, field: string, maxItems: number, maxLength: number) {
  if (!Array.isArray(value) || value.length > maxItems) invalid(field, `${field} 不是有效数组。`);
  return (value as unknown[]).map((item) => text(item, field, maxLength));
}

function jsonArray(value: unknown, field: string, maxItems: number, maxBytes: number) {
  if (!Array.isArray(value) || value.length > maxItems) invalid(field, `${field} 不是有效数组。`);
  jsonSize(value, field, maxBytes);
  return value as unknown[];
}

function jsonObject(value: unknown, field: string, maxBytes: number) {
  const result = object(value, field);
  jsonSize(result, field, maxBytes);
  return result;
}

function jsonSize(value: unknown, field: string, maxBytes: number) {
  let encoded = "";
  try { encoded = JSON.stringify(value); } catch { invalid(field, `${field} 无法序列化。`); }
  if (new TextEncoder().encode(encoded).byteLength > maxBytes) invalid(field, `${field} 超出允许大小。`);
}

function enumValue<T extends string>(value: unknown, field: string, allowed: readonly T[]) {
  if (!allowed.includes(value as T)) invalid(field, `${field} 使用了不支持的值。`);
  return value as T;
}

function walletCurrency(value: unknown, field: string) {
  if (typeof value !== "string" || !/^[A-Z]{3}$/.test(value)) invalid(field, `${field} 必须是三位大写币种代码。`);
  return value as string;
}

function walletMinor(value: unknown, field: string) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0 || result > MAX_WALLET_BALANCE_MINOR) {
    invalid(field, `${field} 不是有效的钱包金额。`);
  }
  return result;
}

function nullableWalletChange(value: unknown, field: string) {
  if (value === null) return null;
  const result = Number(value);
  if (!Number.isSafeInteger(result) || Math.abs(result) > MAX_WALLET_BALANCE_MINOR) invalid(field, `${field} 不是有效的金额变化。`);
  return result;
}

function hash(value: unknown, field: string) {
  const result = requiredText(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) invalid(field, `${field} 不是有效的 SHA-256。`);
  return result;
}

function mediaFileName(value: unknown) {
  const result = requiredText(value, "file_name", 255);
  if (result === "." || result === ".." || result.includes("/") || result.includes("\\")) {
    invalid("file_name", "媒体文件名不能包含路径。");
  }
}

function imageDataUrl(value: unknown, field: string, maxBytes: number) {
  const result = String(value || "").trim();
  if (!result) return;
  const match = result.match(/^data:image\/(png|jpeg|webp);base64,([a-z0-9+/=\s]+)$/i);
  if (!match) invalid(field, `${field} 必须是 PNG、JPEG 或 WebP Data URL。`);
  const base64 = match![2].replace(/\s/g, "");
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const bytes = Math.floor(base64.length * 3 / 4) - padding;
  if (bytes < 1 || bytes > maxBytes) invalid(field, `${field} 超出允许大小。`);
}

function invalid(field: string, message: string): never {
  throw new ApiError(`${message}（${field}）`, 400, "LOCAL_MUTATION_INVALID");
}
