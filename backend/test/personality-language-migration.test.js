const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { openDatabase } = require("../src/infrastructure/database");

test("personality language migration rewrites stored system wording", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-personality-migration-"));
  let database;
  try {
    database = new DatabaseSync(path.join(dataDir, "xuanai.db"));
    database.exec(`
      CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL);
      CREATE TABLE assistant_personality_events(
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        trait_key TEXT NOT NULL,
        trait_value TEXT NOT NULL
      );
      CREATE TABLE assistant_profiles(
        user_id TEXT PRIMARY KEY,
        name TEXT NOT NULL DEFAULT '小玄',
        traits_json TEXT NOT NULL
      );
      CREATE TABLE user_profiles(
        user_id TEXT PRIMARY KEY,
        display_name TEXT NOT NULL DEFAULT '',
        preferred_name TEXT NOT NULL DEFAULT ''
      );
      CREATE TABLE album_moments(
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        detail TEXT NOT NULL DEFAULT '',
        mood TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE album_moment_sources(
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        source_excerpt TEXT NOT NULL DEFAULT ''
      );
    `);
    const markApplied = database.prepare(
      "INSERT INTO schema_migrations(version, applied_at) VALUES (?, 1)"
    );
    for (let version = 1; version <= 18; version += 1) markApplied.run(version);
    database.prepare(
      "INSERT INTO assistant_personality_events(id, content, trait_key, trait_value) VALUES (?, ?, ?, ?)"
    ).run("event", "助手学会了画图", "ability_gained", "drawing_diary_self_portrait");
    database.prepare(
      "INSERT INTO assistant_profiles(user_id, traits_json) VALUES (?, ?)"
    ).run("user", JSON.stringify([{
      key: "ability_gained",
      value: "drawing_diary_self_portrait",
      strength: 0.7,
      evidenceCount: 1,
      updatedAt: 1
    }]));
    database.close();
    database = null;
    database = openDatabase(dataDir);

    const event = database.prepare(
      "SELECT content, trait_key AS traitKey, trait_value AS traitValue FROM assistant_personality_events"
    ).get();
    const profile = database.prepare("SELECT traits_json AS traitsJson FROM assistant_profiles").get();
    assert.deepEqual({ ...event }, {
      content: "我学会了画图",
      traitKey: "新学会的能力",
      traitValue: "学会画图、写手记和创作自画像"
    });
    assert.deepEqual(JSON.parse(profile.traitsJson)[0], {
      key: "新学会的能力",
      value: "学会画图、写手记和创作自画像",
      strength: 0.7,
      evidenceCount: 1,
      updatedAt: 1
    });
  } finally {
    if (database) database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
