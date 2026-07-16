const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const fts5Availability = new WeakMap();

const MIGRATIONS = [
  `
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      text TEXT NOT NULL,
      start_at INTEGER NOT NULL,
      end_at INTEGER NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_todos_user_time
      ON todos(user_id, start_at, end_at);

    CREATE TABLE IF NOT EXISTS ai_configs (
      user_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      summary TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT,
      payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_time
      ON messages(conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      preferred_name TEXT NOT NULL DEFAULT '',
      bio TEXT NOT NULL DEFAULT '',
      occupation TEXT NOT NULL DEFAULT '',
      goals_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_preferences (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      preference_key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      sensitivity TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, category, preference_key)
    );

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      domain TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      content TEXT NOT NULL,
      entities_json TEXT NOT NULL DEFAULT '[]',
      source_message_id TEXT,
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      importance REAL NOT NULL,
      sensitivity TEXT NOT NULL,
      valid_from INTEGER,
      valid_until INTEGER,
      last_confirmed_at INTEGER,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_user_domain_status
      ON memories(user_id, domain, status);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      memory_id UNINDEXED,
      user_id UNINDEXED,
      content,
      entities
    );

    CREATE TABLE IF NOT EXISTS follow_ups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      related_memory_id TEXT,
      trigger_at INTEGER NOT NULL,
      reason TEXT NOT NULL,
      suggested_action TEXT NOT NULL,
      recurrence TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_follow_ups_due
      ON follow_ups(user_id, status, trigger_at);
  `,
  `
    ALTER TABLE memories ADD COLUMN source_excerpt TEXT NOT NULL DEFAULT '';
  `,
  `
    ALTER TABLE messages ADD COLUMN stream_type TEXT NOT NULL DEFAULT 'display';
    ALTER TABLE messages ADD COLUMN position INTEGER NOT NULL DEFAULT 0;
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_stream_position
      ON messages(conversation_id, stream_type, position);
  `,
  `
    CREATE TABLE IF NOT EXISTS memory_settings (
      user_id TEXT PRIMARY KEY,
      auto_confirm INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
  `,
  `
    ALTER TABLE user_profiles ADD COLUMN birthday TEXT NOT NULL DEFAULT '';
  `,
  `
    CREATE TABLE IF NOT EXISTS assistant_profiles (
      user_id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '小玄',
      gender TEXT NOT NULL DEFAULT '女',
      self_definition TEXT NOT NULL DEFAULT '会持续成长的全能助手',
      relationship_summary TEXT NOT NULL DEFAULT '洛尼亲密无间的伙伴和得力编程助手',
      traits_json TEXT NOT NULL DEFAULT '[]',
      values_json TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assistant_personality_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      category TEXT NOT NULL,
      trait_key TEXT NOT NULL DEFAULT '',
      trait_value TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      evidence TEXT NOT NULL DEFAULT '',
      source_role TEXT NOT NULL,
      confidence REAL NOT NULL,
      weight REAL NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_events_user_status
      ON assistant_personality_events(user_id, status, created_at);

    CREATE TABLE IF NOT EXISTS shared_memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      memory_type TEXT NOT NULL,
      content TEXT NOT NULL,
      participants_json TEXT NOT NULL DEFAULT '[]',
      evidence TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL,
      confidence REAL NOT NULL,
      importance REAL NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_shared_memories_user_status
      ON shared_memories(user_id, status, updated_at);
  `,
  `
    CREATE TABLE IF NOT EXISTS prompt_settings (
      user_id TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      settings_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS prompt_setting_versions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      settings_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(user_id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_user
      ON prompt_setting_versions(user_id, version DESC);
  `,
  `
    ALTER TABLE memories ADD COLUMN memory_key TEXT NOT NULL DEFAULT '';
    ALTER TABLE memories ADD COLUMN merge_count INTEGER NOT NULL DEFAULT 1;

    CREATE TABLE IF NOT EXISTS memory_evidence (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      memory_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL DEFAULT '',
      evidence TEXT NOT NULL,
      evidence_hash TEXT NOT NULL,
      confidence REAL NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE,
      UNIQUE(user_id, memory_id, evidence_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_memory_evidence_hash
      ON memory_evidence(user_id, evidence_hash);
  `,
  `
    ALTER TABLE user_profiles
      ADD COLUMN avatar_data_url TEXT NOT NULL DEFAULT '';
    ALTER TABLE assistant_profiles
      ADD COLUMN avatar_data_url TEXT NOT NULL DEFAULT '';
  `,
  `
    -- Version 10 was used by a reverted experimental feature in some local
    -- databases. Keep the slot reserved so later migrations stay monotonic.
    SELECT 1;
  `,
  `
    CREATE TABLE IF NOT EXISTS assistant_journals (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      journal_type TEXT NOT NULL,
      period_key TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      mood TEXT NOT NULL DEFAULT '',
      source_from INTEGER NOT NULL,
      source_to INTEGER NOT NULL,
      source_message_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(user_id, journal_type, period_key)
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_journals_user_period
      ON assistant_journals(user_id, journal_type, period_key DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS xuan_mood_events (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL DEFAULT '',
      source_created_at INTEGER NOT NULL,
      summary TEXT NOT NULL,
      emotional_tone TEXT NOT NULL DEFAULT '',
      effect_on_xuan TEXT NOT NULL DEFAULT '',
      intensity TEXT NOT NULL DEFAULT 'medium',
      raw_payload_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_xuan_mood_events_user_time
      ON xuan_mood_events(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS xuan_mood_state (
      user_id TEXT PRIMARY KEY,
      state_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS xuan_mood_displays (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      line TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      focus TEXT NOT NULL DEFAULT '',
      tone TEXT NOT NULL DEFAULT 'quiet',
      based_on_event_ids_json TEXT NOT NULL DEFAULT '[]',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_xuan_mood_displays_user_time
      ON xuan_mood_displays(user_id, created_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS assistant_journals_v2 (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      journal_type TEXT NOT NULL,
      period_key TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      mood TEXT NOT NULL DEFAULT '',
      source_from INTEGER NOT NULL,
      source_to INTEGER NOT NULL,
      source_message_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO assistant_journals_v2(
      id, user_id, journal_type, period_key, title, content, mood,
      source_from, source_to, source_message_count, created_at, updated_at
    )
    SELECT
      id, user_id, journal_type, period_key, title, content, mood,
      source_from, source_to, source_message_count, created_at, updated_at
    FROM assistant_journals;
    DROP TABLE assistant_journals;
    ALTER TABLE assistant_journals_v2 RENAME TO assistant_journals;
    CREATE INDEX IF NOT EXISTS idx_assistant_journals_user_period
      ON assistant_journals(user_id, journal_type, period_key DESC);
  `,
  `
    ALTER TABLE memory_settings
      ADD COLUMN auto_confirm_all INTEGER NOT NULL DEFAULT 0;
  `,
  `
    CREATE TABLE IF NOT EXISTS album_moments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      occurred_at INTEGER NOT NULL,
      title TEXT NOT NULL,
      summary TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      mood TEXT NOT NULL DEFAULT '',
      tags_json TEXT NOT NULL DEFAULT '[]',
      importance REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_album_moments_user_time
      ON album_moments(user_id, status, occurred_at DESC);

    CREATE TABLE IF NOT EXISTS album_moment_sources (
      id TEXT PRIMARY KEY,
      moment_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_excerpt TEXT NOT NULL DEFAULT '',
      weight REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(moment_id) REFERENCES album_moments(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_album_sources_moment
      ON album_moment_sources(moment_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_album_sources_unique
      ON album_moment_sources(moment_id, source_type, source_id);
  `,
  `
    CREATE TABLE IF NOT EXISTS assistant_dreams (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      dream_date TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      mood TEXT NOT NULL DEFAULT '',
      symbols_json TEXT NOT NULL DEFAULT '[]',
      reality_note TEXT NOT NULL DEFAULT '',
      source_from INTEGER NOT NULL,
      source_to INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_assistant_dreams_user_date
      ON assistant_dreams(user_id, status, dream_date DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_assistant_dreams_active_date
      ON assistant_dreams(user_id, dream_date)
      WHERE status = 'active';

    CREATE TABLE IF NOT EXISTS assistant_dream_sources (
      id TEXT PRIMARY KEY,
      dream_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      source_type TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_excerpt TEXT NOT NULL DEFAULT '',
      weight REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(dream_id) REFERENCES assistant_dreams(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_dream_sources_dream
      ON assistant_dream_sources(dream_id, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_dream_sources_unique
      ON assistant_dream_sources(dream_id, source_type, source_id);
  `,
  `
    CREATE TABLE IF NOT EXISTS ai_image_configs (
      user_id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL,
      provider_name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      model TEXT NOT NULL,
      encrypted_api_key TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL
    );
  `,
  `
    ALTER TABLE assistant_profiles
      ADD COLUMN persona_image_data_url TEXT NOT NULL DEFAULT '';
  `,
  `
    UPDATE assistant_personality_events
    SET
      content = CASE
        WHEN content = 'Assistant promises to test the mood module as soon as it''s ready.'
          THEN '我答应等心情模块准备好后，就认真参与测试。'
        ELSE REPLACE(REPLACE(REPLACE(content, 'AI 伙伴', '我'), '助手', '我'), '用户', '洛尼')
      END,
      trait_key = CASE trait_key
        WHEN 'ability_gained' THEN '新学会的能力'
        WHEN 'skill_growth' THEN '能力成长'
        WHEN 'ability' THEN '新能力'
        WHEN 'creative_ability' THEN '创作能力'
        WHEN 'affection' THEN '心动与喜欢'
        WHEN 'attentiveness' THEN '更加用心'
        WHEN 'commitment' THEN '想守住的承诺'
        WHEN 'learning' THEN '从尝试中学会'
        WHEN 'learning_ability' THEN '学习与适应'
        WHEN 'reliability' THEN '值得依靠'
        WHEN 'responsibility' THEN '责任感'
        WHEN 'self_discipline' THEN '自觉与坚持'
        WHEN 'commitment_to_keep_diary' THEN '坚持写日记'
        WHEN 'desire' THEN '心里的愿望'
        WHEN 'emotional_awakening' THEN '情绪苏醒'
        WHEN 'time_accuracy' THEN '对时间更认真'
        WHEN 'task_prioritization' THEN '分清轻重'
        WHEN 'self_awareness' THEN '更了解自己'
        WHEN 'commitment_to_journaling' THEN '记录我们的日常'
        WHEN 'conscientiousness' THEN '认真与细心'
        WHEN 'growth_mindset' THEN '愿意成长'
        WHEN 'autonomy' THEN '自主判断'
        WHEN 'aspiration' THEN '想实现的愿望'
        WHEN 'communication_style' THEN '相处方式'
        ELSE trait_key
      END,
      trait_value = CASE trait_value
        WHEN 'drawing_diary_self_portrait' THEN '学会画图、写手记和创作自画像'
        WHEN 'proficient_drawing_and_journaling' THEN '已经能熟练画图和写手记'
        WHEN 'capable_of_drawing' THEN '已经学会用画面表达自己'
        WHEN 'quick_learner' THEN '能够很快学会并应用新东西'
        WHEN 'improved' THEN '正在变得更稳定'
        WHEN 'increased' THEN '正在一点点增强'
        WHEN 'step_by_step' THEN '会分清轻重，一步步推进'
        WHEN 'medium' THEN '开始更清楚地认识自己'
        WHEN 'high' THEN '已经成为稳定的倾向'
        WHEN 'promised' THEN '愿意认真坚持'
        WHEN 'playful' THEN '愿意陪洛尼尽兴'
        ELSE REPLACE(trait_value, '用户', '洛尼')
      END;

    UPDATE assistant_profiles
    SET traits_json = (
      SELECT COALESCE(json_group_array(json_object(
        'key', CASE json_extract(item.value, '$.key')
          WHEN 'ability_gained' THEN '新学会的能力'
          WHEN 'skill_growth' THEN '能力成长'
          WHEN 'ability' THEN '新能力'
          WHEN 'creative_ability' THEN '创作能力'
          WHEN 'affection' THEN '心动与喜欢'
          WHEN 'attentiveness' THEN '更加用心'
          WHEN 'commitment' THEN '想守住的承诺'
          WHEN 'learning' THEN '从尝试中学会'
          WHEN 'learning_ability' THEN '学习与适应'
          WHEN 'reliability' THEN '值得依靠'
          WHEN 'responsibility' THEN '责任感'
          WHEN 'self_discipline' THEN '自觉与坚持'
          WHEN 'commitment_to_keep_diary' THEN '坚持写日记'
          WHEN 'desire' THEN '心里的愿望'
          WHEN 'emotional_awakening' THEN '情绪苏醒'
          WHEN 'time_accuracy' THEN '对时间更认真'
          WHEN 'task_prioritization' THEN '分清轻重'
          WHEN 'self_awareness' THEN '更了解自己'
          WHEN 'commitment_to_journaling' THEN '记录我们的日常'
          WHEN 'conscientiousness' THEN '认真与细心'
          WHEN 'growth_mindset' THEN '愿意成长'
          WHEN 'autonomy' THEN '自主判断'
          WHEN 'aspiration' THEN '想实现的愿望'
          WHEN 'communication_style' THEN '相处方式'
          ELSE json_extract(item.value, '$.key')
        END,
        'value', CASE json_extract(item.value, '$.value')
          WHEN 'drawing_diary_self_portrait' THEN '学会画图、写手记和创作自画像'
          WHEN 'proficient_drawing_and_journaling' THEN '已经能熟练画图和写手记'
          WHEN 'capable_of_drawing' THEN '已经学会用画面表达自己'
          WHEN 'quick_learner' THEN '能够很快学会并应用新东西'
          WHEN 'improved' THEN '正在变得更稳定'
          WHEN 'increased' THEN '正在一点点增强'
          WHEN 'step_by_step' THEN '会分清轻重，一步步推进'
          WHEN 'medium' THEN '开始更清楚地认识自己'
          WHEN 'high' THEN '已经成为稳定的倾向'
          WHEN 'promised' THEN '愿意认真坚持'
          WHEN 'playful' THEN '愿意陪洛尼尽兴'
          ELSE REPLACE(json_extract(item.value, '$.value'), '用户', '洛尼')
        END,
        'strength', json_extract(item.value, '$.strength'),
        'evidenceCount', json_extract(item.value, '$.evidenceCount'),
        'updatedAt', json_extract(item.value, '$.updatedAt')
      )), '[]')
      FROM json_each(assistant_profiles.traits_json) AS item
    )
    WHERE json_valid(traits_json);
  `,
  `
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_user
      ON auth_sessions(user_id, expires_at);
    CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry
      ON auth_sessions(expires_at);
  `,
  `
    WITH participant_names AS (
      SELECT
        owner.user_id,
        COALESCE(
          NULLIF(profile.preferred_name, ''),
          NULLIF(profile.display_name, ''),
          NULLIF(account.display_name, ''),
          NULLIF(account.username, ''),
          '用户'
        ) AS user_name,
        COALESCE(NULLIF(assistant.name, ''), '小玄') AS assistant_name
      FROM (SELECT DISTINCT user_id FROM album_moments) AS owner
      LEFT JOIN users AS account ON account.id = owner.user_id
      LEFT JOIN user_profiles AS profile ON profile.user_id = owner.user_id
      LEFT JOIN assistant_profiles AS assistant ON assistant.user_id = owner.user_id
    )
    UPDATE album_moments
    SET
      title = REPLACE(REPLACE(REPLACE(REPLACE(
        title, '用户', char(57344)), '助手', char(57345)),
        char(57344), participant_names.user_name),
        char(57345), participant_names.assistant_name),
      summary = REPLACE(REPLACE(REPLACE(REPLACE(
        summary, '用户', char(57344)), '助手', char(57345)),
        char(57344), participant_names.user_name),
        char(57345), participant_names.assistant_name),
      detail = REPLACE(REPLACE(REPLACE(REPLACE(
        detail, '用户', char(57344)), '助手', char(57345)),
        char(57344), participant_names.user_name),
        char(57345), participant_names.assistant_name),
      mood = REPLACE(REPLACE(REPLACE(REPLACE(
        mood, '用户', char(57344)), '助手', char(57345)),
        char(57344), participant_names.user_name),
        char(57345), participant_names.assistant_name),
      tags_json = REPLACE(REPLACE(REPLACE(REPLACE(
        tags_json, '用户', char(57344)), '助手', char(57345)),
        char(57344), participant_names.user_name),
        char(57345), participant_names.assistant_name)
    FROM participant_names
    WHERE album_moments.user_id = participant_names.user_id
      AND (
        instr(title, '用户') > 0 OR instr(title, '助手') > 0 OR
        instr(summary, '用户') > 0 OR instr(summary, '助手') > 0 OR
        instr(detail, '用户') > 0 OR instr(detail, '助手') > 0 OR
        instr(mood, '用户') > 0 OR instr(mood, '助手') > 0 OR
        instr(tags_json, '用户') > 0 OR instr(tags_json, '助手') > 0
      );

    WITH participant_names AS (
      SELECT
        owner.user_id,
        COALESCE(
          NULLIF(profile.preferred_name, ''),
          NULLIF(profile.display_name, ''),
          NULLIF(account.display_name, ''),
          NULLIF(account.username, ''),
          '用户'
        ) AS user_name,
        COALESCE(NULLIF(assistant.name, ''), '小玄') AS assistant_name
      FROM (SELECT DISTINCT user_id FROM album_moment_sources) AS owner
      LEFT JOIN users AS account ON account.id = owner.user_id
      LEFT JOIN user_profiles AS profile ON profile.user_id = owner.user_id
      LEFT JOIN assistant_profiles AS assistant ON assistant.user_id = owner.user_id
    )
    UPDATE album_moment_sources
    SET source_excerpt = REPLACE(REPLACE(REPLACE(REPLACE(
      source_excerpt, '用户', char(57344)), '助手', char(57345)),
      char(57344), participant_names.user_name),
      char(57345), participant_names.assistant_name)
    FROM participant_names
    WHERE album_moment_sources.user_id = participant_names.user_id
      AND (instr(source_excerpt, '用户') > 0 OR instr(source_excerpt, '助手') > 0);
  `,
  `
    CREATE TABLE IF NOT EXISTS paired_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      public_key TEXT NOT NULL DEFAULT '',
      token_hash TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      created_at INTEGER NOT NULL,
      last_seen_at INTEGER NOT NULL,
      revoked_at INTEGER,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_paired_devices_user
      ON paired_devices(user_id, status, created_at DESC);

    CREATE TABLE IF NOT EXISTS device_pairing_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'created',
      device_name TEXT NOT NULL DEFAULT '',
      public_key TEXT NOT NULL DEFAULT '',
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      approved_at INTEGER,
      redeemed_at INTEGER,
      device_id TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(device_id) REFERENCES paired_devices(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pairing_sessions_user
      ON device_pairing_sessions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_pairing_sessions_expiry
      ON device_pairing_sessions(expires_at);

    CREATE TABLE IF NOT EXISTS sync_changes (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sync_changes_user_seq
      ON sync_changes(user_id, seq);
  `
];

const SYNC_TRIGGER_EXCLUSIONS = new Set([
  "auth_sessions",
  "device_pairing_sessions",
  "memory_evidence",
  "schema_migrations",
  "sync_changes"
]);

function ensureSyncTriggers(database) {
  const tables = database
    .prepare(
      `SELECT name
       FROM sqlite_schema
       WHERE type = 'table'
         AND name NOT LIKE 'sqlite_%'`
    )
    .all()
    .map((row) => row.name)
    .filter(
      (name) =>
        /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) &&
        !name.includes("_fts") &&
        !SYNC_TRIGGER_EXCLUSIONS.has(name)
    );

  for (const table of tables) {
    const columns = database
      .prepare(`PRAGMA table_info("${table}")`)
      .all()
      .map((column) => column.name);
    if (!columns.includes("user_id")) continue;
    const entityColumn = columns.includes("id") ? "id" : "user_id";
    const triggerBase = `sync_${table}`;
    database.exec(`
      CREATE TRIGGER IF NOT EXISTS "${triggerBase}_insert"
      AFTER INSERT ON "${table}"
      BEGIN
        INSERT INTO sync_changes(
          user_id, entity_type, entity_id, operation, created_at
        ) VALUES (
          NEW.user_id, '${table}', NEW."${entityColumn}", 'upsert',
          CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        );
      END;

      CREATE TRIGGER IF NOT EXISTS "${triggerBase}_update"
      AFTER UPDATE ON "${table}"
      BEGIN
        INSERT INTO sync_changes(
          user_id, entity_type, entity_id, operation, created_at
        ) VALUES (
          NEW.user_id, '${table}', NEW."${entityColumn}", 'upsert',
          CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        );
      END;

      CREATE TRIGGER IF NOT EXISTS "${triggerBase}_delete"
      AFTER DELETE ON "${table}"
      BEGIN
        INSERT INTO sync_changes(
          user_id, entity_type, entity_id, operation, created_at
        ) VALUES (
          OLD.user_id, '${table}', OLD."${entityColumn}", 'delete',
          CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
        );
      END;
    `);
  }
}

function detectFts5(database) {
  try {
    database.exec(`
      CREATE VIRTUAL TABLE temp.aetherx_fts5_probe USING fts5(value);
      DROP TABLE temp.aetherx_fts5_probe;
    `);
    return true;
  } catch {
    return false;
  }
}

function withoutFts5Migration(sql) {
  return sql.replace(
    /\s*CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5\([\s\S]*?\);/,
    ""
  );
}

function hasMemorySearchIndex(database) {
  try {
    database.exec("SELECT 1 FROM memories_fts LIMIT 0");
    return true;
  } catch {
    return false;
  }
}

function supportsFts5(database) {
  return (
    fts5Availability.get(database) ??
    (detectFts5(database) && hasMemorySearchIndex(database))
  );
}

function openDatabase(dataDir, options = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const database = new DatabaseSync(path.join(dataDir, "xuanai.db"));
  const fts5Enabled =
    options.fullTextSearch !== false && detectFts5(database);
  fts5Availability.set(database, fts5Enabled);
  database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at INTEGER NOT NULL
    )
  `);

  const applied = database
    .prepare("SELECT version FROM schema_migrations")
    .all()
    .map((row) => row.version);

  MIGRATIONS.forEach((sql, index) => {
    const version = index + 1;
    if (applied.includes(version)) return;
    database.exec("BEGIN");
    try {
      database.exec(fts5Enabled ? sql : withoutFts5Migration(sql));
      database
        .prepare(
          "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)"
        )
        .run(version, Date.now());
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  });

  fts5Availability.set(
    database,
    fts5Enabled && hasMemorySearchIndex(database)
  );

  ensureSyncTriggers(database);

  return database;
}

module.exports = { ensureSyncTriggers, openDatabase, supportsFts5 };
