const { HttpError } = require("../../lib/http-error");

const DEFAULT_CONFIG = Object.freeze({
  providerId: "openai",
  providerName: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4-mini",
  encryptedApiKey: ""
});

class AiConfigRepository {
  constructor(database, secretBox) {
    this.database = database;
    this.secretBox = secretBox;
  }

  getStored(userId) {
    const row = this.database
      .prepare(
        `SELECT provider_id, provider_name, base_url, model, encrypted_api_key
         FROM ai_configs WHERE user_id = ?`
      )
      .get(userId);
    if (!row) return { ...DEFAULT_CONFIG };
    return {
      providerId: row.provider_id,
      providerName: row.provider_name,
      baseUrl: row.base_url,
      model: row.model,
      encryptedApiKey: row.encrypted_api_key
    };
  }

  getPublic(userId) {
    const stored = this.getStored(userId);
    return {
      providerId: stored.providerId,
      providerName: stored.providerName,
      baseUrl: stored.baseUrl,
      model: stored.model,
      hasApiKey: Boolean(stored.encryptedApiKey)
    };
  }

  getCredentials(userId) {
    const stored = this.getStored(userId);
    let apiKey = "";
    try {
      apiKey = this.secretBox.decrypt(stored.encryptedApiKey);
    } catch {
      throw new HttpError(
        500,
        "AI_KEY_DECRYPTION_FAILED",
        "无法读取已保存的 AI 凭证。"
      );
    }
    return { ...stored, apiKey };
  }

  save(userId, input) {
    const normalized = normalizeConfig(input);
    const current = this.getStored(userId);
    const providedKey = String(input.apiKey || "").trim();
    const sameProvider =
      normalized.providerId === current.providerId &&
      normalized.baseUrl === current.baseUrl;
    const encryptedApiKey = providedKey
      ? this.secretBox.encrypt(providedKey)
      : sameProvider
        ? current.encryptedApiKey
        : "";

    this.database
      .prepare(
        `INSERT INTO ai_configs(
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
      )
      .run(
        userId,
        normalized.providerId,
        normalized.providerName,
        normalized.baseUrl,
        normalized.model,
        encryptedApiKey,
        Date.now()
      );
    return this.getPublic(userId);
  }
}

function normalizeConfig(input) {
  const providerId = String(input.providerId || "custom").slice(0, 60);
  const providerName = String(input.providerName || "自定义").slice(0, 80);
  const baseUrl = String(input.baseUrl || "").trim().replace(/\/+$/, "");
  const model = String(input.model || "").trim().slice(0, 200);
  if (!baseUrl) throw new HttpError(400, "INVALID_BASE_URL", "请填写 API 端点。");
  if (!model) throw new HttpError(400, "INVALID_MODEL", "请填写模型名称。");
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new HttpError(400, "INVALID_BASE_URL", "API 端点格式不正确。");
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw new HttpError(400, "INVALID_BASE_URL", "API 端点必须是安全的 HTTP 地址。");
  }
  return { providerId, providerName, baseUrl, model };
}

module.exports = { AiConfigRepository, normalizeConfig };
