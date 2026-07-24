const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");
const test = require("node:test");
const { openDatabase } = require("../src/infrastructure/database");
const { createSecretBox } = require("../src/infrastructure/secret-box");
const { ArchiveService } = require("../src/modules/archive/archive-service");
const { decryptArchive, encryptPayload } = require("../src/modules/archive/archive-crypto");
const {
  DIGEST_ALGORITHM,
  FORMAT_VERSION,
  TABLES,
  continuityDigest,
  encodeMetadata,
  legacyContinuityDigest,
  readMetadata,
  validateMetadata
} = require("../src/modules/archive/archive-format");

test("存档摘要使用跨运行环境稳定的排序，并兼容旧版 localeCompare 摘要", () => {
  const records = Object.fromEntries(TABLES.map((table) => [table, []]));
  records.todos = [
    { id: "_", user_id: "user", text: "underscore", due_at: 1, reminder_at: 2, completed: 0, created_at: 1, updated_at: 1 },
    { id: "-", user_id: "user", text: "dash", due_at: 1, reminder_at: 2, completed: 0, created_at: 1, updated_at: 1 }
  ];
  const base = {
    account: { displayName: "洛尼" },
    credentials: { aiApiKey: "chat", imageApiKey: "image" },
    records,
    media: []
  };
  const stableDigest = continuityDigest(base);
  const legacyDigest = legacyContinuityDigest(base);
  assert.notEqual(stableDigest, legacyDigest);

  const legacy = {
    ...base,
    formatVersion: 1,
    continuityDigest: legacyDigest
  };
  const normalized = validateMetadata(legacy);
  assert.equal(normalized.continuityDigest, stableDigest);
  assert.equal(normalized.digestAlgorithm, DIGEST_ALGORITHM);

  assert.throws(
    () => validateMetadata({
      ...base,
      formatVersion: FORMAT_VERSION,
      digestAlgorithm: DIGEST_ALGORITHM,
      continuityDigest: "0".repeat(64)
    }),
    (error) => error.code === "ARCHIVE_DIGEST_MISMATCH"
  );
});

test("完整存档往返恢复 AI 连续性，同时保留登录与设备凭据", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-archive-"));
  const database = openDatabase(dataDir);
  context.after(() => {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const secretBox = createSecretBox(dataDir, "target-hub-key");
  const service = new ArchiveService({ database, secretBox, dataDir });
  const userId = "user-archive";
  const now = 1_720_000_000_000;
  seedUser(database, secretBox, userId, now);
  database.prepare("INSERT INTO users(id,username,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run("other-user", "other", "其他账号", "other-hash", now, now);
  database.prepare("INSERT INTO todos VALUES (?,?,?,?,?,?,?,?)")
    .run("other-todo", "other-user", "绝不能进入洛尼的存档", now, now + 1, 0, now, now);
  const mediaBytes = Buffer.from("aetherx-media-fixture");
  const mediaHash = crypto.createHash("sha256").update(mediaBytes).digest("hex");
  fs.mkdirSync(path.join(dataDir, "media"), { recursive: true });
  fs.writeFileSync(path.join(dataDir, "media", "media-one.png"), mediaBytes);
  database.prepare(
    `INSERT INTO media_assets(id,user_id,mime_type,file_name,byte_size,content_hash,created_at,preview_file_name,preview_byte_size)
     VALUES (?,?,?,?,?,?,?,?,?)`
  ).run("media-1", userId, "image/png", "media-one.png", mediaBytes.length, mediaHash, now, "", 0);

  const exported = await service.createDownload(userId, "archive-password");
  const entry = service.takeDownload(exported.ticket);
  context.after(() => service.releaseDownload(entry));
  assert.equal(fs.readFileSync(entry.filePath).includes(Buffer.from("chat-secret")), false);
  assert.equal(fs.readFileSync(entry.filePath).includes(Buffer.from("绝不能进入洛尼的存档")), false);

  database.prepare("UPDATE assistant_profiles SET name = '被改掉的小玄' WHERE user_id = ?").run(userId);
  database.prepare("UPDATE users SET password_hash = 'new-password-hash' WHERE id = ?").run(userId);
  database.prepare("UPDATE auth_sessions SET token_hash = 'new-session-token' WHERE user_id = ?").run(userId);
  database.prepare("UPDATE paired_devices SET token_hash = 'new-device-token' WHERE user_id = ?").run(userId);

  await assert.rejects(
    service.restoreRequest(userId, fs.createReadStream(entry.filePath), "wrong-password"),
    (error) => error.code === "ARCHIVE_DECRYPT_FAILED"
  );
  assert.equal(
    database.prepare("SELECT name FROM assistant_profiles WHERE user_id = ?").get(userId).name,
    "被改掉的小玄"
  );

  const corruptPath = path.join(dataDir, "corrupt.aetherx");
  const corruptBytes = fs.readFileSync(entry.filePath);
  corruptBytes[Math.floor(corruptBytes.length / 2)] ^= 0xff;
  fs.writeFileSync(corruptPath, corruptBytes);
  await assert.rejects(
    service.restoreRequest(userId, fs.createReadStream(corruptPath), "archive-password"),
    (error) => error.code === "ARCHIVE_DECRYPT_FAILED"
  );
  assert.equal(
    database.prepare("SELECT name FROM assistant_profiles WHERE user_id = ?").get(userId).name,
    "被改掉的小玄"
  );

  const unsupportedPayload = path.join(dataDir, "unsupported.payload");
  const unsupportedArchive = path.join(dataDir, "unsupported.aetherx");
  await decryptArchive(entry.filePath, unsupportedPayload, "archive-password");
  const parsed = readMetadata(unsupportedPayload, fs);
  const encodedUnsupported = encodeMetadata({ ...parsed.metadata, formatVersion: 999 });
  const payloadBytes = fs.readFileSync(unsupportedPayload);
  await encryptPayload(
    Readable.from([Buffer.concat([
      encodedUnsupported.length,
      encodedUnsupported.bytes,
      payloadBytes.subarray(parsed.mediaOffset)
    ])]),
    unsupportedArchive,
    "archive-password"
  );
  await assert.rejects(
    service.restoreRequest(userId, fs.createReadStream(unsupportedArchive), "archive-password"),
    (error) => error.code === "ARCHIVE_VERSION_UNSUPPORTED"
  );
  assert.equal(
    database.prepare("SELECT name FROM assistant_profiles WHERE user_id = ?").get(userId).name,
    "被改掉的小玄"
  );

  const badMediaArchive = path.join(dataDir, "bad-media.aetherx");
  const badMediaMetadata = structuredClone(parsed.metadata);
  badMediaMetadata.media[0].contentHash = "0".repeat(64);
  badMediaMetadata.records.media_assets[0].content_hash = "0".repeat(64);
  badMediaMetadata.continuityDigest = continuityDigest(badMediaMetadata);
  const encodedBadMedia = encodeMetadata(badMediaMetadata);
  await encryptPayload(
    Readable.from([Buffer.concat([
      encodedBadMedia.length,
      encodedBadMedia.bytes,
      payloadBytes.subarray(parsed.mediaOffset)
    ])]),
    badMediaArchive,
    "archive-password"
  );
  await assert.rejects(
    service.restoreRequest(userId, fs.createReadStream(badMediaArchive), "archive-password"),
    (error) => error.code === "ARCHIVE_MEDIA_HASH_MISMATCH"
  );
  assert.equal(
    database.prepare("SELECT name FROM assistant_profiles WHERE user_id = ?").get(userId).name,
    "被改掉的小玄"
  );

  const restored = await service.restoreRequest(
    userId,
    fs.createReadStream(entry.filePath),
    "archive-password"
  );
  assert.equal(restored.continuityDigest, exported.summary.continuityDigest);
  assert.equal(restored.resetRequired, true);
  assert.match(restored.backupFileName, /\.aetherx$/);
  assert.equal(
    database.prepare("SELECT name FROM assistant_profiles WHERE user_id = ?").get(userId).name,
    "小玄"
  );
  assert.equal(
    secretBox.decrypt(database.prepare("SELECT encrypted_api_key FROM ai_configs WHERE user_id = ?").get(userId).encrypted_api_key),
    "chat-secret"
  );
  assert.equal(
    secretBox.decrypt(database.prepare("SELECT encrypted_api_key FROM ai_image_configs WHERE user_id = ?").get(userId).encrypted_api_key),
    "image-secret"
  );
  assert.equal(database.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId).password_hash, "new-password-hash");
  assert.equal(database.prepare("SELECT token_hash FROM auth_sessions WHERE user_id = ?").get(userId).token_hash, "new-session-token");
  assert.equal(database.prepare("SELECT token_hash FROM paired_devices WHERE user_id = ?").get(userId).token_hash, "new-device-token");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM mobile_client_health WHERE user_id = ?").get(userId).count, 1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM sync_changes WHERE user_id = ? AND entity_type = 'archive_restore' AND operation = 'reset'").get(userId).count, 1);
  assert.equal(database.prepare("SELECT text FROM todos WHERE user_id = 'other-user'").get().text, "绝不能进入洛尼的存档");
  assert.deepEqual(fs.readFileSync(path.join(dataDir, "media", "media-one.png")), mediaBytes);
});

test("AI 正在运行时拒绝生成或恢复存档", async (context) => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-archive-busy-"));
  const database = openDatabase(dataDir);
  context.after(() => {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const userId = "busy-user";
  database.prepare("INSERT INTO users(id,username,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)")
    .run(userId, "busy", "Busy", "hash", 1, 1);
  const service = new ArchiveService({
    database,
    secretBox: createSecretBox(dataDir, "busy-key"),
    dataDir,
    isAgentBusy: () => true
  });
  await assert.rejects(
    service.createDownload(userId, "archive-password"),
    (error) => error.code === "ARCHIVE_AGENT_BUSY"
  );
});

function seedUser(database, secretBox, userId, now) {
  const run = (sql, ...values) => database.prepare(sql).run(...values);
  run("INSERT INTO users(id,username,display_name,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)", userId, "archive", "洛尼", "old-password-hash", now, now);
  run("INSERT INTO auth_sessions(id,user_id,token_hash,created_at,last_used_at,expires_at) VALUES (?,?,?,?,?,?)", "session-1", userId, "old-session-token", now, now, now + 10000);
  run("INSERT INTO paired_devices(id,user_id,name,public_key,token_hash,status,created_at,last_seen_at,revoked_at) VALUES (?,?,?,?,?,?,?,?,?)", "device-1", userId, "手机", "key", "old-device-token", "active", now, now, null);
  run("INSERT INTO mobile_client_health(id,user_id,paired_device_id,name,platform,model,os_version,app_version,protocol_version,sync_status,sync_cursor,sse_connected,foreground,latency_ms,last_error,last_heartbeat_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", "install-1", userId, "device-1", "手机", "android", "model", "14", "1.0", 1, "online", 0, 1, 1, 20, "", now, now, now);
  run("INSERT INTO todos VALUES (?,?,?,?,?,?,?,?)", "todo-1", userId, "一起完成存档", now, now + 1, 0, now, now);
  run("INSERT INTO ai_configs VALUES (?,?,?,?,?,?,?)", userId, "openai", "OpenAI", "https://example.com", "chat-model", secretBox.encrypt("chat-secret"), now);
  run("INSERT INTO ai_image_configs VALUES (?,?,?,?,?,?,?)", userId, "image", "Image", "https://example.com", "image-model", secretBox.encrypt("image-secret"), now);
  run("INSERT INTO conversations VALUES (?,?,?,?,?,?)", "conversation-1", userId, "存档", "完整记录", now, now);
  run("INSERT INTO messages VALUES (?,?,?,?,?,?,?,?)", "message-1", "conversation-1", "assistant", "我会记得", JSON.stringify({ image: { mediaId: "media-1" } }), now, "display", 0);
  run("INSERT INTO user_profiles VALUES (?,?,?,?,?,?,?,?,?)", userId, "洛尼", "洛尼", "简介", "开发者", "[]", now, "", "");
  run("INSERT INTO user_preferences VALUES (?,?,?,?,?,?,?,?,?,?)", "preference-1", userId, "style", "language", '"中文"', "explicit", 1, "normal", now, now);
  run("INSERT INTO memories VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", "memory-1", userId, "relationship", "fact", "我们在做完整存档", "[]", "message-1", "explicit", 1, 1, "normal", now, null, now, "active", now, now, "完整存档", "archive", 1);
  run("INSERT INTO follow_ups VALUES (?,?,?,?,?,?,?,?,?,?)", "follow-1", userId, "memory-1", now + 1000, "继续", "验证存档", null, "active", now, now);
  run("INSERT INTO memory_settings VALUES (?,?,?,?)", userId, 1, now, 0);
  run("INSERT INTO assistant_profiles VALUES (?,?,?,?,?,?,?,?,?,?)", userId, "小玄", "女", "数字伙伴", "洛尼的搭子", "[]", "[]", now, "", "");
  run("INSERT INTO assistant_personality_events VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", "event-1", userId, "growth", "可靠", "稳定", "学会完整恢复", "测试", "assistant", 1, 1, "confirmed", now);
  run("INSERT INTO shared_memories VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", "shared-1", userId, "milestone", "完成存档", "[]", "测试", "explicit", 1, 1, "active", now, now);
  run("INSERT INTO prompt_settings VALUES (?,?,?,?)", userId, 1, "{}", now);
  run("INSERT INTO prompt_setting_versions VALUES (?,?,?,?,?)", "prompt-1", userId, 1, "{}", now);
  run("INSERT INTO memory_evidence VALUES (?,?,?,?,?,?,?,?)", "evidence-1", userId, "memory-1", "conversation-1", "证据", "hash", 1, now);
  run("INSERT INTO assistant_journals VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", "journal-1", userId, "daily", "2026-01-01", "手记", "内容", "开心", now, now, 1, now, now);
  run("INSERT INTO xuan_mood_events VALUES (?,?,?,?,?,?,?,?,?,?,?)", "mood-event-1", userId, "chat", "message-1", now, "开心", "warm", "成长", "medium", "{}", now);
  run("INSERT INTO xuan_mood_state VALUES (?,?,?)", userId, "{}", now);
  run("INSERT INTO xuan_mood_displays VALUES (?,?,?,?,?,?,?,?,?,?)", "mood-display-1", userId, "心情", "很好", "", "", "warm", "[]", now + 1000, now);
  run("INSERT INTO album_moments VALUES (?,?,?,?,?,?,?,?,?,?,?,?)", "album-1", userId, now, "时刻", "摘要", "详情", "开心", "[]", 1, "active", now, now);
  run("INSERT INTO album_moment_sources VALUES (?,?,?,?,?,?,?,?)", "album-source-1", "album-1", userId, "message", "message-1", "片段", 1, now);
  run("INSERT INTO assistant_dreams VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", "dream-1", userId, "2026-01-01", "梦", "内容", "柔和", "[]", "虚构", now, now, "active", now, now);
  run("INSERT INTO assistant_dream_sources VALUES (?,?,?,?,?,?,?,?)", "dream-source-1", "dream-1", userId, "message", "message-1", "片段", 1, now);
}
