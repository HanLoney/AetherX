const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { openDatabase } = require("../src/infrastructure/database");
const {
  initializeAccountProfiles,
  isPristineAccountProfile
} = require("../src/modules/auth/account-defaults");

test("only untouched registration profiles are safe to replace during Hub bootstrap", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-account-defaults-"));
  const database = openDatabase(dataDir);
  try {
    const now = Date.now();
    database.prepare(
      `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("user-1", "release-user", "发布验收用户", "hash", now, now);
    initializeAccountProfiles(database, "user-1", "发布验收用户", now);

    assert.equal(isPristineAccountProfile(database, "user_profiles", "user-1"), true);
    assert.equal(isPristineAccountProfile(database, "assistant_profiles", "user-1"), true);

    database.prepare("UPDATE user_profiles SET bio = ? WHERE user_id = ?")
      .run("用户已经编辑过简介", "user-1");
    database.prepare("UPDATE assistant_profiles SET relationship_summary = ? WHERE user_id = ?")
      .run("用户已经编辑过关系", "user-1");

    assert.equal(isPristineAccountProfile(database, "user_profiles", "user-1"), false);
    assert.equal(isPristineAccountProfile(database, "assistant_profiles", "user-1"), false);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
