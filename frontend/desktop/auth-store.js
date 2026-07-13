const fs = require("node:fs");
const path = require("node:path");

class AuthStore {
  constructor(filePath, safeStorage) {
    this.filePath = filePath;
    this.safeStorage = safeStorage;
  }

  load() {
    try {
      const stored = JSON.parse(fs.readFileSync(this.filePath, "utf8"));
      return {
        serverUrl: normalizeServerUrl(stored.serverUrl),
        token: this.decryptToken(stored.encryptedToken),
        user: sanitizeUser(stored.user)
      };
    } catch {
      return { serverUrl: "", token: "", user: null };
    }
  }

  save({ serverUrl, token, user }) {
    const payload = {
      serverUrl: normalizeServerUrl(serverUrl),
      encryptedToken: this.encryptToken(token),
      user: sanitizeUser(user)
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(payload), { mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }

  clearSession(serverUrl = "") {
    this.save({ serverUrl, token: "", user: null });
  }

  encryptToken(token) {
    if (!token || !this.safeStorage?.isEncryptionAvailable()) return "";
    return this.safeStorage.encryptString(String(token)).toString("base64");
  }

  decryptToken(encryptedToken) {
    if (!encryptedToken || !this.safeStorage?.isEncryptionAvailable()) return "";
    try {
      return this.safeStorage.decryptString(Buffer.from(encryptedToken, "base64"));
    } catch {
      return "";
    }
  }
}

function normalizeServerUrl(value) {
  const result = String(value || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(result) ? result : "";
}

function sanitizeUser(user) {
  if (!user?.id || !user?.username) return null;
  return {
    id: String(user.id),
    username: String(user.username),
    displayName: String(user.displayName || user.username)
  };
}

module.exports = { AuthStore, normalizeServerUrl };
