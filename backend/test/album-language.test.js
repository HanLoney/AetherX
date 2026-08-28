const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openDatabase } = require("../src/infrastructure/database");
const {
  AlbumService,
  personalizeRoles
} = require("../src/modules/album/album-service");

test("album role placeholders are replaced with participant names before saving", () => {
  assert.equal(
    personalizeRoles("用户对助手说了爱你，助手把用户的话记下。", {
      userName: "洛尼",
      assistantName: "小玄"
    }),
    "洛尼对小玄说了爱你，小玄把洛尼的话记下。"
  );

  const saved = { moment: null, source: null };
  const repository = {
    getParticipantNames: () => ({ userName: "洛尼", assistantName: "小玄" }),
    saveMoment(_userId, moment) {
      saved.moment = { id: "moment-1", ...moment };
      return saved.moment;
    },
    addSource(_userId, _momentId, source) {
      saved.source = source;
    },
    findMoment() {
      return { ...saved.moment, sources: saved.source ? [saved.source] : [] };
    }
  };
  const service = new AlbumService(repository);

  const result = service.createMoment("user-1", {
    title: "用户和助手的纪念",
    summary: "用户对助手说爱你。",
    detail: "助手记住了用户的话。",
    sources: [
      {
        sourceType: "shared_memory",
        sourceId: "source-1",
        sourceExcerpt: "用户对助手说爱你。"
      }
    ]
  });

  assert.equal(result.title, "洛尼和小玄的纪念");
  assert.equal(result.summary, "洛尼对小玄说爱你。");
  assert.equal(result.detail, "小玄记住了洛尼的话。");
  assert.equal(result.sources[0].sourceExcerpt, "洛尼对小玄说爱你。");
});

test("album language migration personalizes existing moments and sources", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-album-language-"));
  let database = openDatabase(dataDir);
  const now = Date.now();
  try {
    database
      .prepare(
        `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run("user-1", "loney", "洛尼账号", "hash", now, now);
    database
      .prepare(
        `INSERT INTO user_profiles(user_id, display_name, preferred_name, updated_at)
         VALUES (?, ?, ?, ?)`
      )
      .run("user-1", "洛尼账号", "洛尼", now);
    database
      .prepare(
        `INSERT INTO assistant_profiles(user_id, name, updated_at)
         VALUES (?, ?, ?)`
      )
      .run("user-1", "小玄", now);
    database
      .prepare(
        `INSERT INTO album_moments(
           id, user_id, occurred_at, title, summary, detail, mood,
           tags_json, importance, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "moment-1",
        "user-1",
        now,
        "用户与助手的一天",
        "用户对助手说爱你。",
        "助手把用户的话收进纪念册。",
        "助手很开心",
        '["用户","助手"]',
        0.8,
        "active",
        now,
        now
      );
    database
      .prepare(
        `INSERT INTO album_moment_sources(
           id, moment_id, user_id, source_type, source_id,
           source_excerpt, weight, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        "source-1",
        "moment-1",
        "user-1",
        "shared_memory",
        "memory-1",
        "用户对助手说爱你，助手记录了这个时刻。",
        0.9,
        now
      );

    database
      .prepare("DELETE FROM schema_migrations WHERE version = ?")
      .run(21);
    database.close();
    database = null;
    database = openDatabase(dataDir);

    const moment = database
      .prepare(
        "SELECT title, summary, detail, mood, tags_json FROM album_moments WHERE id = ?"
      )
      .get("moment-1");
    const source = database
      .prepare(
        "SELECT source_excerpt FROM album_moment_sources WHERE id = ?"
      )
      .get("source-1");

    assert.equal(moment.title, "洛尼与小玄的一天");
    assert.equal(moment.summary, "洛尼对小玄说爱你。");
    assert.equal(moment.detail, "小玄把洛尼的话收进纪念册。");
    assert.equal(moment.mood, "小玄很开心");
    assert.deepEqual(JSON.parse(moment.tags_json), ["洛尼", "小玄"]);
    assert.equal(
      source.source_excerpt,
      "洛尼对小玄说爱你，小玄记录了这个时刻。"
    );
  } finally {
    database?.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
