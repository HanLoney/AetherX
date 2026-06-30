const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function readOrCreateKey(dataDir, configuredKey) {
  if (configuredKey) {
    return crypto.createHash("sha256").update(configuredKey).digest();
  }

  const keyPath = path.join(dataDir, ".master-key");
  try {
    return Buffer.from(fs.readFileSync(keyPath, "utf8"), "base64");
  } catch {
    const key = crypto.randomBytes(32);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(keyPath, key.toString("base64"), {
      encoding: "utf8",
      mode: 0o600
    });
    return key;
  }
}

function createSecretBox(dataDir, configuredKey) {
  const key = readOrCreateKey(dataDir, configuredKey);

  return {
    encrypt(value) {
      if (!value) return "";
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const encrypted = Buffer.concat([
        cipher.update(value, "utf8"),
        cipher.final()
      ]);
      return [
        "v1",
        iv.toString("base64"),
        cipher.getAuthTag().toString("base64"),
        encrypted.toString("base64")
      ].join(".");
    },
    decrypt(value) {
      if (!value) return "";
      const [version, iv, tag, encrypted] = value.split(".");
      if (version !== "v1" || !iv || !tag || !encrypted) return "";
      const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        Buffer.from(iv, "base64")
      );
      decipher.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted, "base64")),
        decipher.final()
      ]).toString("utf8");
    }
  };
}

module.exports = { createSecretBox };
