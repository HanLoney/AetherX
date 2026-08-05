const {
  createCipheriv,
  createDecipheriv,
  randomBytes
} = require("node:crypto");
const { HttpError } = require("../../lib/http-error");
const { canonicalStringify } = require("./operation-codec");

const SPACE_SECRET_ENVELOPE_VERSION = 1;
const SPACE_SECRET_ALGORITHM = "A256GCM";

function encryptSpaceSecret(value, key, aad, keyVersion = 1) {
  const plaintext = String(value || "");
  if (!plaintext) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(canonicalStringify(aad), "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final()
  ]);
  return {
    version: SPACE_SECRET_ENVELOPE_VERSION,
    algorithm: SPACE_SECRET_ALGORITHM,
    keyVersion: Number(keyVersion),
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64")
  };
}

function decryptSpaceSecret(envelope, key, aad, expectedKeyVersion = null) {
  if (envelope === null) return "";
  try {
    if (
      !envelope ||
      envelope.version !== SPACE_SECRET_ENVELOPE_VERSION ||
      envelope.algorithm !== SPACE_SECRET_ALGORITHM ||
      !Number.isSafeInteger(Number(envelope.keyVersion)) ||
      Number(envelope.keyVersion) < 1 ||
      (expectedKeyVersion !== null &&
        Number(envelope.keyVersion) !== Number(expectedKeyVersion))
    ) {
      throw new Error("invalid envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      decodeBase64(envelope.iv)
    );
    decipher.setAAD(Buffer.from(canonicalStringify(aad), "utf8"));
    decipher.setAuthTag(decodeBase64(envelope.authenticationTag));
    return Buffer.concat([
      decipher.update(decodeBase64(envelope.ciphertext)),
      decipher.final()
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(
      400,
      "REPLICATION_SECRET_INVALID",
      "复制凭证无法解密、密钥版本不匹配或已经损坏。"
    );
  }
}

function providerCredentialAad(spaceId, entityType, entityId = "config") {
  return {
    purpose: "aetherx-provider-credential",
    spaceId,
    entityType,
    entityId
  };
}

function decodeBase64(value) {
  const input = String(value || "");
  const buffer = Buffer.from(input, "base64");
  if (!input || buffer.toString("base64") !== input) {
    throw new Error("invalid base64");
  }
  return buffer;
}

module.exports = {
  decryptSpaceSecret,
  encryptSpaceSecret,
  providerCredentialAad,
  SPACE_SECRET_ALGORITHM,
  SPACE_SECRET_ENVELOPE_VERSION
};
