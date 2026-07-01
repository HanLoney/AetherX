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
