const { createHmac, randomBytes, timingSafeEqual } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");

const SYNC_KEY_BYTES = 32;

class SpaceKeyService {
  constructor({ repository, secretBox, now = () => Date.now() }) {
    this.repository = repository;
    this.secretBox = secretBox;
    this.now = now;
  }

  ensure(spaceId) {
    const existing = this.repository.find(spaceId);
    if (existing) {
      const result = this.decrypt(existing);
      this.signLegacyOperations(spaceId, result.key);
      return result;
    }
    return this.import(spaceId, randomBytes(SYNC_KEY_BYTES).toString("base64"));
  }

  import(spaceId, syncKey) {
    const normalized = normalizeSyncKey(syncKey);
    const existing = this.repository.find(spaceId);
    if (existing) {
      const current = this.decrypt(existing);
      if (!safeBufferEqual(current.key, normalized)) {
        throw new HttpError(
          409,
          "SPACE_KEY_MISMATCH",
          "本地已经保存了不同的数据空间密钥。"
        );
      }
      return current;
    }
    const now = this.now();
    const stored = this.repository.save({
      spaceId,
      keyVersion: 1,
      encryptedSyncKey: this.secretBox.encrypt(normalized.toString("base64")),
      createdAt: now,
      rotatedAt: null
    });
    const result = this.decrypt(stored);
    this.signLegacyOperations(spaceId, result.key);
    return result;
  }

  signLegacyOperations(spaceId, syncKey) {
    for (const operation of this.repository.listUnsignedOperations(spaceId)) {
      const authenticationTag = createHmac("sha256", syncKey)
        .update(operation.operation_hash, "utf8")
        .digest("hex");
      this.repository.updateOperationAuthenticationTag(
        operation.operation_id,
        authenticationTag
      );
    }
  }

  decrypt(row) {
    const decrypted = this.secretBox.decrypt(row.encrypted_sync_key);
    if (!decrypted) {
      throw new HttpError(500, "SPACE_KEY_UNAVAILABLE", "数据空间密钥无法解密。");
    }
    return {
      key: normalizeSyncKey(decrypted),
      keyVersion: Number(row.key_version),
      createdAt: Number(row.created_at),
      rotatedAt: row.rotated_at === null ? null : Number(row.rotated_at)
    };
  }
}

function normalizeSyncKey(value) {
  let key;
  try {
    key = Buffer.isBuffer(value) ? Buffer.from(value) : Buffer.from(String(value), "base64");
  } catch {
    key = Buffer.alloc(0);
  }
  if (key.length !== SYNC_KEY_BYTES) {
    throw new HttpError(400, "SPACE_KEY_INVALID", "数据空间密钥必须是 32 字节。");
  }
  return key;
}

function safeBufferEqual(left, right) {
  return left.length === right.length && timingSafeEqual(left, right);
}

module.exports = { SpaceKeyService, SYNC_KEY_BYTES };
