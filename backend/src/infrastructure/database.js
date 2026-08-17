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
      relationship_summary TEXT NOT NULL DEFAULT '与用户相互信任的数字伙伴',
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
  `,
  `
    CREATE TABLE IF NOT EXISTS media_assets (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_name TEXT NOT NULL UNIQUE,
      byte_size INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, content_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_media_assets_user_created
      ON media_assets(user_id, created_at DESC);
  `,
  `
    ALTER TABLE media_assets
      ADD COLUMN preview_file_name TEXT NOT NULL DEFAULT '';
    ALTER TABLE media_assets
      ADD COLUMN preview_byte_size INTEGER NOT NULL DEFAULT 0;
  `,
  `
    CREATE TABLE IF NOT EXISTS mobile_client_health (
      id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      paired_device_id TEXT,
      name TEXT NOT NULL,
      platform TEXT NOT NULL,
      model TEXT NOT NULL DEFAULT '',
      os_version TEXT NOT NULL DEFAULT '',
      app_version TEXT NOT NULL DEFAULT '',
      protocol_version INTEGER NOT NULL DEFAULT 1,
      sync_status TEXT NOT NULL DEFAULT 'idle',
      sync_cursor INTEGER NOT NULL DEFAULT 0,
      sse_connected INTEGER NOT NULL DEFAULT 0,
      foreground INTEGER NOT NULL DEFAULT 1,
      latency_ms INTEGER,
      last_error TEXT NOT NULL DEFAULT '',
      last_heartbeat_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(id, user_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(paired_device_id) REFERENCES paired_devices(id) ON DELETE SET NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mobile_health_user_seen
      ON mobile_client_health(user_id, last_heartbeat_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS module_settings (
      user_id TEXT NOT NULL,
      module_id TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(user_id, module_id),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_module_settings_user
      ON module_settings(user_id, updated_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS wallet_accounts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      balance_minor INTEGER NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'CNY',
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_accounts_user_updated
      ON wallet_accounts(user_id, updated_at DESC, created_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS wallet_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      change_minor INTEGER,
      balance_before_minor INTEGER NOT NULL,
      balance_after_minor INTEGER NOT NULL,
      previous_currency TEXT NOT NULL,
      currency TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'manual',
      created_at INTEGER NOT NULL,
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(account_id) REFERENCES wallet_accounts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wallet_transactions_account_time
      ON wallet_transactions(user_id, account_id, created_at DESC, id DESC);
  `,
  `
    INSERT INTO wallet_transactions(
      id, user_id, account_id, event_type, change_minor,
      balance_before_minor, balance_after_minor, previous_currency,
      currency, detail, source, created_at
    )
    SELECT
      'wallet-opening-' || account.id,
      account.user_id,
      account.id,
      'create',
      COALESCE(
        (
          SELECT first_transaction.balance_before_minor
          FROM wallet_transactions AS first_transaction
          WHERE first_transaction.user_id = account.user_id
            AND first_transaction.account_id = account.id
          ORDER BY first_transaction.created_at ASC, first_transaction.rowid ASC
          LIMIT 1
        ),
        account.balance_minor
      ),
      0,
      COALESCE(
        (
          SELECT first_transaction.balance_before_minor
          FROM wallet_transactions AS first_transaction
          WHERE first_transaction.user_id = account.user_id
            AND first_transaction.account_id = account.id
          ORDER BY first_transaction.created_at ASC, first_transaction.rowid ASC
          LIMIT 1
        ),
        account.balance_minor
      ),
      COALESCE(
        (
          SELECT first_transaction.previous_currency
          FROM wallet_transactions AS first_transaction
          WHERE first_transaction.user_id = account.user_id
            AND first_transaction.account_id = account.id
          ORDER BY first_transaction.created_at ASC, first_transaction.rowid ASC
          LIMIT 1
        ),
        account.currency
      ),
      COALESCE(
        (
          SELECT first_transaction.previous_currency
          FROM wallet_transactions AS first_transaction
          WHERE first_transaction.user_id = account.user_id
            AND first_transaction.account_id = account.id
          ORDER BY first_transaction.created_at ASC, first_transaction.rowid ASC
          LIMIT 1
        ),
        account.currency
      ),
      '期初余额（历史数据补全）',
      'manual',
      MIN(
        account.created_at,
        COALESCE(
          (
            SELECT first_transaction.created_at - 1
            FROM wallet_transactions AS first_transaction
            WHERE first_transaction.user_id = account.user_id
              AND first_transaction.account_id = account.id
            ORDER BY first_transaction.created_at ASC, first_transaction.rowid ASC
            LIMIT 1
          ),
          account.created_at
        )
      )
    FROM wallet_accounts AS account
    WHERE NOT EXISTS (
      SELECT 1
      FROM wallet_transactions AS existing
      WHERE existing.user_id = account.user_id
        AND existing.account_id = account.id
        AND existing.event_type = 'create'
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS hub_instance (
      singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
      node_id TEXT NOT NULL UNIQUE,
      node_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      public_identity TEXT NOT NULL DEFAULT '',
      protocol_version INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS aetherx_spaces (
      id TEXT PRIMARY KEY,
      local_user_id TEXT NOT NULL UNIQUE,
      display_name TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(local_user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hub_nodes (
      id TEXT NOT NULL,
      space_id TEXT NOT NULL,
      node_name TEXT NOT NULL,
      platform TEXT NOT NULL,
      public_identity TEXT NOT NULL DEFAULT '',
      protocol_version INTEGER NOT NULL,
      schema_version INTEGER NOT NULL,
      status TEXT NOT NULL,
      last_seen_at INTEGER,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      PRIMARY KEY(space_id, id),
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hub_nodes_space_status
      ON hub_nodes(space_id, status, created_at);

    CREATE TABLE IF NOT EXISTS hub_endpoints (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      transport TEXT NOT NULL,
      address TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      certificate_fingerprint TEXT NOT NULL DEFAULT '',
      last_success_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(space_id, node_id, transport, address),
      FOREIGN KEY(space_id, node_id) REFERENCES hub_nodes(space_id, id)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hub_endpoints_node_priority
      ON hub_endpoints(space_id, node_id, priority DESC);

    CREATE TABLE IF NOT EXISTS hub_cluster_state (
      space_id TEXT PRIMARY KEY,
      epoch INTEGER NOT NULL,
      active_node_id TEXT NOT NULL,
      transition_id TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL,
      state_hash TEXT NOT NULL,
      control_signature TEXT NOT NULL DEFAULT '',
      updated_at INTEGER NOT NULL,
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE,
      FOREIGN KEY(space_id, active_node_id) REFERENCES hub_nodes(space_id, id)
    );

    CREATE TABLE IF NOT EXISTS replication_operations (
      operation_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      origin_node_id TEXT NOT NULL,
      origin_sequence INTEGER NOT NULL,
      epoch INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      entity_version INTEGER NOT NULL,
      previous_entity_version INTEGER,
      payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      previous_operation_hash TEXT NOT NULL DEFAULT '',
      operation_hash TEXT NOT NULL,
      authentication_tag TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      UNIQUE(space_id, origin_node_id, origin_sequence),
      FOREIGN KEY(space_id, origin_node_id) REFERENCES hub_nodes(space_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_replication_operations_space_origin
      ON replication_operations(space_id, origin_node_id, origin_sequence);
    CREATE INDEX IF NOT EXISTS idx_replication_operations_entity
      ON replication_operations(space_id, entity_type, entity_id, entity_version);

    CREATE TABLE IF NOT EXISTS replication_entity_versions (
      space_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(space_id, entity_type, entity_id),
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS replication_watermarks (
      space_id TEXT NOT NULL,
      peer_node_id TEXT NOT NULL,
      origin_node_id TEXT NOT NULL,
      contiguous_sequence INTEGER NOT NULL,
      operation_hash TEXT NOT NULL,
      acknowledged_at INTEGER NOT NULL,
      PRIMARY KEY(space_id, peer_node_id, origin_node_id),
      FOREIGN KEY(space_id, peer_node_id) REFERENCES hub_nodes(space_id, id),
      FOREIGN KEY(space_id, origin_node_id) REFERENCES hub_nodes(space_id, id)
    );

    CREATE TABLE IF NOT EXISTS applied_operations (
      operation_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      applied_at INTEGER NOT NULL,
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_applied_operations_space_time
      ON applied_operations(space_id, applied_at);

    CREATE TABLE IF NOT EXISTS idempotency_requests (
      space_id TEXT NOT NULL,
      request_id TEXT NOT NULL,
      result_status INTEGER NOT NULL,
      result_hash TEXT NOT NULL,
      result_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      PRIMARY KEY(space_id, request_id),
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_idempotency_requests_expiry
      ON idempotency_requests(expires_at);
  `,
  `
    CREATE TABLE IF NOT EXISTS space_data_keys (
      space_id TEXT PRIMARY KEY,
      key_version INTEGER NOT NULL,
      encrypted_sync_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      rotated_at INTEGER,
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hub_peer_credentials (
      space_id TEXT NOT NULL,
      peer_node_id TEXT NOT NULL,
      key_id TEXT NOT NULL,
      encrypted_shared_secret TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      rotated_at INTEGER,
      revoked_at INTEGER,
      PRIMARY KEY(space_id, peer_node_id),
      UNIQUE(space_id, key_id),
      FOREIGN KEY(space_id, peer_node_id) REFERENCES hub_nodes(space_id, id)
        ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS peer_request_nonces (
      space_id TEXT NOT NULL,
      peer_node_id TEXT NOT NULL,
      nonce TEXT NOT NULL,
      request_timestamp INTEGER NOT NULL,
      seen_at INTEGER NOT NULL,
      PRIMARY KEY(space_id, peer_node_id, nonce),
      FOREIGN KEY(space_id, peer_node_id) REFERENCES hub_nodes(space_id, id)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_peer_request_nonces_seen
      ON peer_request_nonces(seen_at);
  `,
  `
    CREATE TABLE IF NOT EXISTS hub_pairing_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      space_id TEXT NOT NULL,
      secret_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      server_ephemeral_public_key TEXT NOT NULL,
      encrypted_server_ephemeral_private_key TEXT NOT NULL,
      requested_node_id TEXT,
      node_name TEXT,
      platform TEXT,
      public_identity TEXT,
      client_ephemeral_public_key TEXT,
      protocol_version INTEGER,
      schema_version INTEGER,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      claimed_at INTEGER,
      approved_at INTEGER,
      redeemed_at INTEGER,
      UNIQUE(space_id, secret_hash),
      FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hub_pairing_sessions_user
      ON hub_pairing_sessions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_hub_pairing_sessions_expiry
      ON hub_pairing_sessions(expires_at);
  `,
  `
    CREATE TABLE IF NOT EXISTS replication_snapshots (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      requested_by_node_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      boundary_json TEXT NOT NULL,
      records_root TEXT NOT NULL,
      blobs_root TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE,
      FOREIGN KEY(space_id, source_node_id) REFERENCES hub_nodes(space_id, id),
      FOREIGN KEY(space_id, requested_by_node_id) REFERENCES hub_nodes(space_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_replication_snapshots_space_time
      ON replication_snapshots(space_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS replication_snapshot_tables (
      snapshot_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      table_root TEXT NOT NULL,
      PRIMARY KEY(snapshot_id, table_name),
      FOREIGN KEY(snapshot_id) REFERENCES replication_snapshots(id) ON DELETE CASCADE
    );
  `,
  `
    CREATE TABLE IF NOT EXISTS replication_snapshot_payloads (
      snapshot_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      encrypted_payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(snapshot_id) REFERENCES replication_snapshots(id) ON DELETE CASCADE,
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS replication_bootstrap_staging (
      snapshot_id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      records_root TEXT NOT NULL,
      blobs_root TEXT NOT NULL,
      boundary_json TEXT NOT NULL,
      encrypted_payload_json TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      verified_at INTEGER,
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE,
      FOREIGN KEY(space_id, source_node_id) REFERENCES hub_nodes(space_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_replication_bootstrap_staging_space
      ON replication_bootstrap_staging(space_id, created_at DESC);
  `,
  `
    CREATE TABLE IF NOT EXISTS replication_blob_staging (
      snapshot_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      received_bytes INTEGER NOT NULL DEFAULT 0,
      temp_file_name TEXT NOT NULL,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(snapshot_id, media_id),
      FOREIGN KEY(snapshot_id) REFERENCES replication_bootstrap_staging(snapshot_id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_replication_blob_staging_status
      ON replication_blob_staging(snapshot_id, status);
  `,
  `
    ALTER TABLE hub_pairing_sessions
      ADD COLUMN source_endpoints_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE hub_pairing_sessions
      ADD COLUMN requested_endpoints_json TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE hub_endpoints
      ADD COLUMN last_failure_at INTEGER;
    ALTER TABLE hub_endpoints
      ADD COLUMN failure_count INTEGER NOT NULL DEFAULT 0;
  `,
  `
    CREATE TABLE IF NOT EXISTS replication_peer_health (
      space_id TEXT NOT NULL,
      peer_node_id TEXT NOT NULL,
      state TEXT NOT NULL,
      last_attempt_at INTEGER,
      last_success_at INTEGER,
      last_error_code TEXT NOT NULL DEFAULT '',
      last_error_message TEXT NOT NULL DEFAULT '',
      consecutive_failures INTEGER NOT NULL DEFAULT 0,
      next_attempt_at INTEGER,
      local_sequence INTEGER NOT NULL DEFAULT 0,
      remote_sequence INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(space_id, peer_node_id),
      FOREIGN KEY(space_id, peer_node_id) REFERENCES hub_nodes(space_id, id)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_replication_peer_health_next_attempt
      ON replication_peer_health(next_attempt_at);
  `,
  `
    CREATE TABLE IF NOT EXISTS replication_media_staging (
      space_id TEXT NOT NULL,
      source_node_id TEXT NOT NULL,
      media_id TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      file_name TEXT NOT NULL,
      byte_size INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      media_created_at INTEGER NOT NULL,
      temp_file_name TEXT NOT NULL,
      received_bytes INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY(space_id, source_node_id, media_id),
      FOREIGN KEY(space_id, source_node_id) REFERENCES hub_nodes(space_id, id)
        ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_replication_media_staging_status
      ON replication_media_staging(space_id, source_node_id, status);
  `,
  `
    ALTER TABLE hub_cluster_state
      ADD COLUMN transition_target_node_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE hub_cluster_state
      ADD COLUMN transition_started_at INTEGER;
  `,
  `
    ALTER TABLE mobile_client_health
      ADD COLUMN local_hub_node_id TEXT NOT NULL DEFAULT '';
    ALTER TABLE mobile_client_health
      ADD COLUMN local_hub_stage TEXT NOT NULL DEFAULT '';
    ALTER TABLE mobile_client_health
      ADD COLUMN local_hub_progress INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mobile_client_health
      ADD COLUMN local_hub_status TEXT NOT NULL DEFAULT '';
    ALTER TABLE mobile_client_health
      ADD COLUMN local_hub_documents INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mobile_client_health
      ADD COLUMN local_hub_media_bytes INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mobile_client_health
      ADD COLUMN local_hub_media_total_bytes INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mobile_client_health
      ADD COLUMN local_hub_pending_media INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE mobile_client_health
      ADD COLUMN local_hub_updated_at INTEGER;
  `,
  `
    CREATE TABLE IF NOT EXISTS hub_forced_takeovers (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      previous_active_node_id TEXT NOT NULL,
      active_node_id TEXT NOT NULL,
      previous_epoch INTEGER NOT NULL,
      epoch INTEGER NOT NULL,
      proof_json TEXT NOT NULL,
      proof_hash TEXT NOT NULL,
      control_signature TEXT NOT NULL,
      integrity_json TEXT NOT NULL,
      status TEXT NOT NULL,
      detected_at INTEGER NOT NULL,
      reconciled_at INTEGER,
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_hub_forced_takeovers_space_epoch
      ON hub_forced_takeovers(space_id, epoch DESC);

    CREATE TABLE IF NOT EXISTS hub_divergent_operations (
      space_id TEXT NOT NULL,
      takeover_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      origin_node_id TEXT NOT NULL,
      origin_sequence INTEGER NOT NULL,
      epoch INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      quarantined_at INTEGER NOT NULL,
      PRIMARY KEY(space_id, takeover_id, operation_id),
      FOREIGN KEY(takeover_id) REFERENCES hub_forced_takeovers(id) ON DELETE CASCADE,
      FOREIGN KEY(operation_id) REFERENCES replication_operations(operation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_hub_divergent_operations_status
      ON hub_divergent_operations(space_id, takeover_id, status);
  `,
  `
    CREATE TABLE IF NOT EXISTS hub_divergence_recoveries (
      id TEXT PRIMARY KEY,
      space_id TEXT NOT NULL,
      takeover_id TEXT NOT NULL,
      authority_node_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      source_epoch INTEGER NOT NULL,
      target_epoch INTEGER NOT NULL,
      status TEXT NOT NULL,
      encrypted_snapshot_json TEXT,
      payload_hash TEXT NOT NULL DEFAULT '',
      snapshot_hash TEXT NOT NULL DEFAULT '',
      control_json TEXT,
      control_signature TEXT NOT NULL DEFAULT '',
      error_code TEXT NOT NULL DEFAULT '',
      error_message TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      completed_at INTEGER,
      FOREIGN KEY(space_id) REFERENCES aetherx_spaces(id) ON DELETE CASCADE,
      FOREIGN KEY(takeover_id) REFERENCES hub_forced_takeovers(id) ON DELETE CASCADE,
      FOREIGN KEY(space_id, authority_node_id) REFERENCES hub_nodes(space_id, id),
      FOREIGN KEY(space_id, target_node_id) REFERENCES hub_nodes(space_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_hub_divergence_recoveries_space_time
      ON hub_divergence_recoveries(space_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS hub_divergence_recovery_chunks (
      recovery_id TEXT NOT NULL,
      byte_offset INTEGER NOT NULL,
      chunk_data BLOB NOT NULL,
      chunk_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY(recovery_id, byte_offset),
      FOREIGN KEY(recovery_id) REFERENCES hub_divergence_recoveries(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS hub_divergent_operation_archive (
      space_id TEXT NOT NULL,
      takeover_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      operation_json TEXT NOT NULL,
      resolution TEXT NOT NULL,
      archived_at INTEGER NOT NULL,
      PRIMARY KEY(space_id, takeover_id, operation_id),
      FOREIGN KEY(takeover_id) REFERENCES hub_forced_takeovers(id) ON DELETE CASCADE
    );
  `
];

const SYNC_TRIGGER_EXCLUSIONS = new Set([
  "auth_sessions",
  "device_pairing_sessions",
  "hub_pairing_sessions",
  "memory_evidence",
  "mobile_client_health",
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
