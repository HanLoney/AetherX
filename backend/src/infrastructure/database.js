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
