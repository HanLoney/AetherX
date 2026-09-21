const { HttpError } = require("../../lib/http-error");

const DEFAULT_CONFIG = Object.freeze({
  providerId: "openai",
  providerName: "OpenAI",
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-5.4-mini",
  encryptedApiKey: "",
  updatedAt: null
});

const DEFAULT_IMAGE_CONFIG = Object.freeze({
  providerId: "volcengine",
  providerName: "火山方舟",
  baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
  model: "doubao-seedream-5-0-260128",
  encryptedApiKey: "",
  updatedAt: null
});

class AiConfigRepository {
  constructor(database, secretBox) {
    this.database = database;
    this.secretBox = secretBox;
  }

  getStored(userId) {
    const row = this.database
      .prepare(
        `SELECT provider_id, provider_name, base_url, model, encrypted_api_key,
                updated_at
         FROM ai_configs WHERE user_id = ?`
      )
      .get(userId);
    if (!row) return { ...DEFAULT_CONFIG };
    return {
      providerId: row.provider_id,
      providerName: row.provider_name,
      baseUrl: row.base_url,
      model: row.model,
      encryptedApiKey: row.encrypted_api_key,
      updatedAt: row.updated_at
    };
  }

  getPublic(userId) {
    const stored = this.getStored(userId);
    const profile = this.getProviderStored(userId, stored.providerId);
    const profileIsActive = Boolean(
      profile &&
      profile.baseUrl === stored.baseUrl &&
      profile.model === stored.model &&
      profile.encryptedApiKey === stored.encryptedApiKey
    );
    return {
      providerId: stored.providerId,
      providerName: stored.providerName,
      baseUrl: stored.baseUrl,
      model: stored.model,
      hasApiKey: Boolean(stored.encryptedApiKey),
      verificationStatus: profileIsActive ? profile.verificationStatus : "untested",
      verifiedAt: profileIsActive ? profile.verifiedAt : null,
      verificationMessage: profileIsActive ? profile.verificationMessage : "",
      updatedAt: stored.updatedAt
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

  save(userId, input, options = {}) {
    const saved = this.saveProvider(userId, input, options);
    return this.activateProvider(userId, saved.providerId, options);
  }

  listProvidersPublic(userId) {
    const active = this.getStored(userId);
    const items = this.database.prepare(
      `SELECT id, provider_id, provider_name, base_url, model,
              encrypted_api_key, verification_status, verified_at,
              verification_message, updated_at
         FROM ai_provider_configs
        WHERE user_id = ?
        ORDER BY updated_at DESC, provider_id ASC`
    ).all(userId).map((row) => publicProviderRow(row, active));
    return { activeProviderId: active.providerId, items };
  }

  getProviderStored(userId, providerId) {
    const row = this.database.prepare(
      `SELECT id, provider_id, provider_name, base_url, model,
              encrypted_api_key, verification_status, verified_at,
              verification_message, updated_at
         FROM ai_provider_configs
        WHERE user_id = ? AND provider_id = ?`
    ).get(userId, String(providerId || ""));
    if (!row) return null;
    return {
      id: row.id,
      providerId: row.provider_id,
      providerName: row.provider_name,
      baseUrl: row.base_url,
      model: row.model,
      encryptedApiKey: row.encrypted_api_key,
      verificationStatus: row.verification_status,
      verifiedAt: row.verified_at,
      verificationMessage: row.verification_message,
      updatedAt: row.updated_at
    };
  }

  getProviderCredentials(userId, providerId) {
    const stored = this.getProviderStored(userId, providerId);
    if (!stored) {
      throw new HttpError(404, "AI_PROVIDER_NOT_SAVED", "这家服务商还没有保存接入配置。");
    }
    let apiKey = "";
    try {
      apiKey = this.secretBox.decrypt(stored.encryptedApiKey);
    } catch {
      throw new HttpError(500, "AI_KEY_DECRYPTION_FAILED", "无法读取已保存的 AI 凭证。");
    }
    return { ...stored, apiKey };
  }

  saveProvider(userId, input, options = {}) {
    const normalized = normalizeConfig(input);
    const currentProfile = this.getProviderStored(userId, normalized.providerId);
    const active = this.getStored(userId);
    const fallback = currentProfile || (active.providerId === normalized.providerId ? active : null);
    const providedKey = String(input.apiKey || "").trim();
    const sameEndpoint = fallback?.baseUrl === normalized.baseUrl;
    const encryptedApiKey = providedKey
      ? this.secretBox.encrypt(providedKey)
      : sameEndpoint
        ? fallback.encryptedApiKey
        : "";
    const unchanged = Boolean(
      currentProfile &&
      !providedKey &&
      currentProfile.baseUrl === normalized.baseUrl &&
      currentProfile.model === normalized.model &&
      currentProfile.providerName === normalized.providerName
    );
    const now = Number(options.now ?? Date.now());

    this.database
      .prepare(
        `INSERT INTO ai_provider_configs(
          id, user_id, provider_id, provider_name, base_url, model,
          encrypted_api_key, verification_status, verified_at,
          verification_message, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, id) DO UPDATE SET
          provider_id = excluded.provider_id,
          provider_name = excluded.provider_name,
          base_url = excluded.base_url,
          model = excluded.model,
          encrypted_api_key = excluded.encrypted_api_key,
          verification_status = excluded.verification_status,
          verified_at = excluded.verified_at,
          verification_message = excluded.verification_message,
          updated_at = excluded.updated_at`
      )
      .run(
        normalized.providerId,
        userId,
        normalized.providerId,
        normalized.providerName,
        normalized.baseUrl,
        normalized.model,
        encryptedApiKey,
        unchanged ? currentProfile.verificationStatus : "untested",
        unchanged ? currentProfile.verifiedAt : null,
        unchanged ? currentProfile.verificationMessage : "",
        now
      );
    return publicProviderStored(
      this.getProviderStored(userId, normalized.providerId),
      this.getStored(userId)
    );
  }

  activateProvider(userId, providerId, options = {}) {
    const stored = this.getProviderStored(userId, providerId);
    if (!stored) {
      throw new HttpError(404, "AI_PROVIDER_NOT_SAVED", "请先保存这家服务商的接入配置。");
    }
    if (!stored.encryptedApiKey) {
      throw new HttpError(400, "AI_KEY_REQUIRED", "请先填写这家服务商的 API Key。");
    }
    const now = Number(options.now ?? Date.now());
    this.database.prepare(
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
    ).run(
      userId,
      stored.providerId,
      stored.providerName,
      stored.baseUrl,
      stored.model,
      stored.encryptedApiKey,
      now
    );
    return this.getPublic(userId);
  }

  markProviderVerification(userId, providerId, status, message = "", options = {}) {
    const normalizedStatus = ["verified", "failed", "untested"].includes(status)
      ? status
      : "untested";
    const now = Number(options.now ?? Date.now());
    const result = this.database.prepare(
      `UPDATE ai_provider_configs
          SET verification_status = ?, verified_at = ?,
              verification_message = ?, updated_at = ?
        WHERE user_id = ? AND provider_id = ?`
    ).run(
      normalizedStatus,
      normalizedStatus === "verified" ? now : null,
      String(message || "").slice(0, 500),
      now,
      userId,
      String(providerId || "")
    );
    if (!result.changes) {
      throw new HttpError(404, "AI_PROVIDER_NOT_SAVED", "这家服务商还没有保存接入配置。");
    }
    return publicProviderStored(
      this.getProviderStored(userId, providerId),
      this.getStored(userId)
    );
  }

  getImageStored(userId) {
    const row = this.database
      .prepare(
        `SELECT provider_id, provider_name, base_url, model, encrypted_api_key,
                updated_at
         FROM ai_image_configs WHERE user_id = ?`
      )
      .get(userId);
    if (!row) return { ...DEFAULT_IMAGE_CONFIG };
    return {
      providerId: row.provider_id,
      providerName: row.provider_name,
      baseUrl: row.base_url,
      model: row.model,
      encryptedApiKey: row.encrypted_api_key,
      updatedAt: row.updated_at
    };
  }

  getImagePublic(userId) {
    const stored = this.getImageStored(userId);
    return {
      providerId: stored.providerId,
      providerName: stored.providerName,
      baseUrl: stored.baseUrl,
      model: stored.model,
      hasApiKey: Boolean(stored.encryptedApiKey),
      updatedAt: stored.updatedAt
    };
  }

  getImageCredentials(userId) {
    const stored = this.getImageStored(userId);
    let apiKey = "";
    try {
      apiKey = this.secretBox.decrypt(stored.encryptedApiKey);
    } catch {
      throw new HttpError(
        500,
        "AI_IMAGE_KEY_DECRYPTION_FAILED",
        "无法读取已保存的图像生成 AI 凭证。"
      );
    }
    return { ...stored, apiKey };
  }

  saveImage(userId, input, options = {}) {
    const normalized = normalizeConfig(input);
    const current = this.getImageStored(userId);
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
        `INSERT INTO ai_image_configs(
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
        Number(options.now ?? Date.now())
      );
    return this.getImagePublic(userId);
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

function publicProviderRow(row, active) {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    baseUrl: row.base_url,
    model: row.model,
    hasApiKey: Boolean(row.encrypted_api_key),
    verificationStatus: row.verification_status || "untested",
    verifiedAt: row.verified_at || null,
    verificationMessage: row.verification_message || "",
    active: providerMatchesActive(row, active),
    updatedAt: row.updated_at
  };
}

function publicProviderStored(stored, active) {
  return {
    id: stored.id,
    providerId: stored.providerId,
    providerName: stored.providerName,
    baseUrl: stored.baseUrl,
    model: stored.model,
    hasApiKey: Boolean(stored.encryptedApiKey),
    verificationStatus: stored.verificationStatus || "untested",
    verifiedAt: stored.verifiedAt || null,
    verificationMessage: stored.verificationMessage || "",
    active: providerMatchesActive({
      provider_id: stored.providerId,
      base_url: stored.baseUrl,
      model: stored.model,
      encrypted_api_key: stored.encryptedApiKey
    }, active),
    updatedAt: stored.updatedAt
  };
}

function providerMatchesActive(row, active) {
  return Boolean(
    active &&
    row.provider_id === active.providerId &&
    row.base_url === active.baseUrl &&
    row.model === active.model &&
    row.encrypted_api_key === active.encryptedApiKey
  );
}

module.exports = { AiConfigRepository, normalizeConfig };
