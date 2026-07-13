const {
  createHash,
  randomBytes,
  timingSafeEqual
} = require("node:crypto");
const { HttpError } = require("../../lib/http-error");
const { hashPassword, verifyPassword } = require("./password");

const SESSION_TOUCH_INTERVAL = 5 * 60 * 1000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 8;

class AuthService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.registrationSecret = String(options.registrationSecret || "");
    this.sessionTtlMs = Math.max(1, Number(options.sessionTtlDays) || 30) * 86400000;
    this.loginAttempts = new Map();
  }

  getRegistrationConfig() {
    const firstUser = this.repository.countUsers() === 0;
    return {
      registrationAvailable: firstUser || Boolean(this.registrationSecret),
      firstUser,
      requiresRegistrationSecret: Boolean(this.registrationSecret)
    };
  }

  async register(input = {}) {
    const username = normalizeUsername(input.username);
    const displayName = normalizeDisplayName(input.displayName, username);
    const password = validatePassword(input.password);
    const passwordHash = await hashPassword(password);
    const token = createToken();
    const tokenHash = hashToken(token);
    const now = Date.now();

    const result = this.repository.transaction(() => {
      const firstUser = this.repository.countUsers() === 0;
      if (!firstUser && !this.registrationSecret) {
        throw new HttpError(403, "REGISTRATION_CLOSED", "当前服务器未开放新账号注册。");
      }
      if (
        this.registrationSecret &&
        !safeTextEqual(String(input.registrationSecret || ""), this.registrationSecret)
      ) {
        throw new HttpError(403, "INVALID_REGISTRATION_SECRET", "注册口令不正确。");
      }
      if (this.repository.findUserByUsername(username)) {
        throw new HttpError(409, "USERNAME_TAKEN", "这个账号名已经被使用了。");
      }

      const user = this.repository.createUser({
        username,
        displayName,
        passwordHash,
        now
      });
      const claimedRows = firstUser
        ? this.repository.claimLegacyData(user.id)
        : 0;
      const session = this.repository.createSession({
        userId: user.id,
        tokenHash,
        now,
        expiresAt: now + this.sessionTtlMs
      });
      return { user, session, claimedRows };
    });

    return {
      token,
      user: presentUser(result.user),
      expiresAt: result.session.expiresAt,
      migratedExistingData: result.claimedRows > 0
    };
  }

  async login(input = {}, remoteAddress = "") {
    const username = normalizeUsername(input.username);
    const password = String(input.password || "");
    const attemptKey = `${String(remoteAddress || "unknown")}|${username.toLocaleLowerCase()}`;
    this.assertLoginAllowed(attemptKey);
    const user = this.repository.findUserByUsername(username);
    const passwordMatches = await verifyPassword(password, user?.password_hash);
    if (!user || !passwordMatches) {
      this.recordLoginFailure(attemptKey);
      throw new HttpError(401, "INVALID_CREDENTIALS", "账号名或密码不正确。");
    }
    this.loginAttempts.delete(attemptKey);

    const token = createToken();
    const now = Date.now();
    this.repository.deleteExpiredSessions(now);
    const session = this.repository.createSession({
      userId: user.id,
      tokenHash: hashToken(token),
      now,
      expiresAt: now + this.sessionTtlMs
    });
    return { token, user: presentUser(user), expiresAt: session.expiresAt };
  }

  authenticate(authorization) {
    const token = bearerToken(authorization);
    if (!token) {
      throw new HttpError(401, "AUTH_REQUIRED", "请先登录。");
    }
    const tokenHash = hashToken(token);
    const session = this.repository.findSession(tokenHash);
    const now = Date.now();
    if (!session || session.expires_at <= now) {
      if (session) this.repository.deleteSession(tokenHash);
      throw new HttpError(401, "SESSION_EXPIRED", "登录状态已失效，请重新登录。");
    }
    if (now - session.last_used_at >= SESSION_TOUCH_INTERVAL) {
      this.repository.touchSession(session.session_id, now);
    }
    return {
      sessionId: session.session_id,
      tokenHash,
      userId: session.user_id,
      user: presentUser(session)
    };
  }

  logout(tokenHash) {
    this.repository.deleteSession(tokenHash);
  }

  assertLoginAllowed(key) {
    const attempt = this.loginAttempts.get(key);
    if (!attempt) return;
    if (Date.now() - attempt.startedAt >= LOGIN_WINDOW_MS) {
      this.loginAttempts.delete(key);
      return;
    }
    if (attempt.failures >= MAX_LOGIN_FAILURES) {
      throw new HttpError(429, "TOO_MANY_LOGIN_ATTEMPTS", "登录尝试过多，请稍后再试。");
    }
  }

  recordLoginFailure(key) {
    const now = Date.now();
    const current = this.loginAttempts.get(key);
    const attempt =
      current && now - current.startedAt < LOGIN_WINDOW_MS
        ? current
        : { failures: 0, startedAt: now };
    attempt.failures += 1;
    this.loginAttempts.set(key, attempt);
    if (this.loginAttempts.size > 10000) {
      for (const [entryKey, entry] of this.loginAttempts) {
        if (now - entry.startedAt >= LOGIN_WINDOW_MS) this.loginAttempts.delete(entryKey);
      }
    }
  }
}

function normalizeUsername(value) {
  const username = String(value || "").trim();
  if (!/^[\p{L}\p{N}._-]{2,32}$/u.test(username)) {
    throw new HttpError(
      400,
      "INVALID_USERNAME",
      "账号名需要 2～32 个字符，只能使用文字、数字、点、横线或下划线。"
    );
  }
  return username;
}

function normalizeDisplayName(value, fallback) {
  return String(value || fallback).trim().slice(0, 40) || fallback;
}

function validatePassword(value) {
  const password = String(value || "");
  if (password.length < 10 || password.length > 128) {
    throw new HttpError(400, "INVALID_PASSWORD", "密码长度需要在 10～128 个字符之间。");
  }
  return password;
}

function createToken() {
  return randomBytes(32).toString("base64url");
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function bearerToken(value) {
  const match = /^Bearer\s+([^\s]+)$/i.exec(String(value || ""));
  return match ? match[1] : "";
}

function safeTextEqual(left, right) {
  const leftHash = createHash("sha256").update(left).digest();
  const rightHash = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftHash, rightHash);
}

function presentUser(row) {
  return {
    id: row.id || row.user_id,
    username: row.username,
    displayName: row.display_name || row.displayName || row.username
  };
}

module.exports = { AuthService, hashToken };
