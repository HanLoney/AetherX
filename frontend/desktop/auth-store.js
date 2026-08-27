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
        refreshToken: this.decryptToken(stored.encryptedRefreshToken),
        user: sanitizeUser(stored.user),
        routing: sanitizeRouting(this.decryptJson(stored.encryptedRouting))
      };
    } catch {
      return { serverUrl: "", token: "", refreshToken: "", user: null, routing: null };
    }
  }

  save({ serverUrl, token, refreshToken = "", user, routing = null }) {
    const payload = {
      serverUrl: normalizeServerUrl(serverUrl),
      encryptedToken: this.encryptToken(token),
      encryptedRefreshToken: this.encryptToken(refreshToken),
      user: sanitizeUser(user),
      encryptedRouting: this.encryptJson(sanitizeRouting(routing))
    };
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    fs.writeFileSync(temporaryPath, JSON.stringify(payload), { mode: 0o600 });
    fs.renameSync(temporaryPath, this.filePath);
  }

  clearSession(serverUrl = "") {
    this.save({ serverUrl, token: "", refreshToken: "", user: null, routing: null });
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

  encryptJson(value) {
    if (!value || !this.safeStorage?.isEncryptionAvailable()) return "";
    return this.safeStorage.encryptString(JSON.stringify(value)).toString("base64");
  }

  decryptJson(encryptedValue) {
    if (!encryptedValue || !this.safeStorage?.isEncryptionAvailable()) return null;
    try {
      return JSON.parse(
        this.safeStorage.decryptString(Buffer.from(encryptedValue, "base64"))
      );
    } catch {
      return null;
    }
  }
}

function normalizeServerUrl(value) {
  const result = String(value || "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(result) ? result : "";
}

function sanitizeUser(user) {
  const identifier = user?.email || user?.username;
  if (!user?.id || !identifier) return null;
  const sanitized = {
    id: String(user.id),
    displayName: String(user.displayName || identifier)
  };
  if (user.email) {
    sanitized.email = String(user.email);
    sanitized.emailVerified = user.emailVerified === true;
  } else {
    sanitized.username = String(user.username);
  }
  return sanitized;
}

function sanitizeRouting(routing) {
  if (!routing?.spaceId || !Array.isArray(routing.nodes)) return null;
  const nodes = routing.nodes
    .map((node) => ({
      nodeId: String(node?.nodeId || ""),
      serverUrl: normalizeServerUrl(node?.serverUrl),
      token: String(node?.token || ""),
      lastSeenAt: Math.max(0, Number(node?.lastSeenAt) || 0)
    }))
    .filter((node) => node.nodeId && node.serverUrl && node.token);
  return {
    spaceId: String(routing.spaceId),
    activeNodeId: String(routing.activeNodeId || ""),
    localNodeId: String(routing.localNodeId || ""),
    epoch: Math.max(1, Number(routing.epoch) || 1),
    nodes
  };
}

function isDirectMobileHubUrl(value) {
  let url;
  try { url = new URL(normalizeServerUrl(value)); } catch { return false; }
  const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
  return port >= 4319 && port <= 4329;
}

function selectAuthenticationSession(stored, fallbackServerUrl) {
  const fallback = normalizeServerUrl(fallbackServerUrl);
  const routingNodes = Array.isArray(stored?.routing?.nodes) ? stored.routing.nodes : [];
  const fallbackNode = routingNodes.find(
    (node) => normalizeServerUrl(node.serverUrl) === fallback && node.token
  );
  if (fallbackNode) {
    return { serverUrl: fallback, token: String(fallbackNode.token) };
  }
  const serverUrl = normalizeServerUrl(stored?.serverUrl);
  if (serverUrl && !isDirectMobileHubUrl(serverUrl)) {
    return { serverUrl, token: String(stored?.token || "") };
  }
  return { serverUrl: fallback, token: "" };
}

function shouldKeepRoutedConnection(candidate, previous) {
  if (
    !candidate?.spaceId ||
    !candidate.localNodeId ||
    candidate.localNodeId !== candidate.activeNodeId
  ) {
    return false;
  }
  if (!previous?.spaceId) return true;
  return candidate.spaceId === previous.spaceId &&
    Number(candidate.epoch) >= Number(previous.epoch);
}

module.exports = {
  AuthStore,
  isDirectMobileHubUrl,
  normalizeServerUrl,
  sanitizeRouting,
  selectAuthenticationSession,
  shouldKeepRoutedConnection
};
