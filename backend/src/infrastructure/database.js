const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

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
  `
];

function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const database = new DatabaseSync(path.join(dataDir, "xuanai.db"));
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
      database.exec(sql);
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

  return database;
}

module.exports = { openDatabase };
