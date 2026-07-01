const { randomUUID } = require("node:crypto");

class MemoryRepository {
  constructor(database) {
    this.database = database;
  }

  list(userId, filters = {}) {
    const conditions = ["user_id = ?"];
    const values = [userId];
    for (const [column, value] of [
      ["domain", filters.domain],
      ["memory_type", filters.type],
      ["status", filters.status]
    ]) {
      if (!value) continue;
      conditions.push(`${column} = ?`);
      values.push(value);
    }
    return this.database
      .prepare(
        `SELECT * FROM memories WHERE ${conditions.join(" AND ")}
         ORDER BY importance DESC, updated_at DESC`
      )
      .all(...values)
      .map(mapMemory);
  }

  search(userId, query) {
    const expression = String(query)
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((term) => `"${term.replaceAll('"', '""')}"`)
      .join(" AND ");
    if (!expression) return this.list(userId, { status: "active" });
    return this.database
      .prepare(
         `SELECT m.* FROM memories_fts f
         JOIN memories m ON m.id = f.memory_id
         WHERE memories_fts MATCH ? AND f.user_id = ?
         ORDER BY rank LIMIT 50`
      )
      .all(expression, userId)
      .map(mapMemory);
  }

  find(userId, id) {
    return mapMemory(
      this.database
        .prepare("SELECT * FROM memories WHERE user_id = ? AND id = ?")
        .get(userId, id)
    );
  }

  create(userId, memory) {
    const now = Date.now();
    const id = randomUUID();
    this.database.exec("BEGIN");
    try {
      this.database
        .prepare(
          `INSERT INTO memories(
            id, user_id, domain, memory_type, content, entities_json,
            source_message_id, source, confidence, importance, sensitivity,
            valid_from, valid_until, last_confirmed_at, status, created_at, updated_at,
            source_excerpt, memory_key, merge_count
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          id,
          userId,
          memory.domain,
          memory.type,
          memory.content,
          JSON.stringify(memory.entities),
          memory.sourceMessageId,
          memory.source,
          memory.confidence,
          memory.importance,
          memory.sensitivity,
          memory.validFrom,
          memory.validUntil,
          memory.status === "active" ? now : null,
          memory.status,
          now,
          now,
          memory.sourceExcerpt,
          memory.memoryKey,
          memory.mergeCount
        );
      this.writeFts(id, userId, memory.content, memory.entities);
      this.database.exec("COMMIT");
      return this.find(userId, id);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  update(userId, id, changes) {
    const current = this.find(userId, id);
    if (!current) return null;
    const next = { ...current, ...changes, updatedAt: Date.now() };
    if (changes.status === "active") next.lastConfirmedAt = Date.now();
    this.database.exec("BEGIN");
    try {
      this.database
        .prepare(
          `UPDATE memories SET domain = ?, memory_type = ?, content = ?,
            entities_json = ?, source = ?, confidence = ?, importance = ?,
            sensitivity = ?, valid_from = ?, valid_until = ?,
            last_confirmed_at = ?, status = ?, updated_at = ?,
            memory_key = ?, merge_count = ?
           WHERE user_id = ? AND id = ?`
        )
        .run(
          next.domain,
          next.type,
          next.content,
          JSON.stringify(next.entities),
          next.source,
          next.confidence,
          next.importance,
          next.sensitivity,
          next.validFrom,
          next.validUntil,
          next.lastConfirmedAt,
          next.status,
          next.updatedAt,
          next.memoryKey,
          next.mergeCount,
          userId,
          id
        );
      this.database
        .prepare("DELETE FROM memories_fts WHERE memory_id = ?")
        .run(id);
      this.writeFts(id, userId, next.content, next.entities);
      this.database.exec("COMMIT");
      return this.find(userId, id);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  delete(userId, id) {
    this.database.exec("BEGIN");
    try {
      this.database
        .prepare("DELETE FROM memories_fts WHERE memory_id = ? AND user_id = ?")
        .run(id, userId);
      const changes = this.database
        .prepare("DELETE FROM memories WHERE user_id = ? AND id = ?")
        .run(userId, id).changes;
      this.database.exec("COMMIT");
      return changes;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  writeFts(id, userId, content, entities) {
    this.database
      .prepare(
        `INSERT INTO memories_fts(memory_id, user_id, content, entities)
         VALUES (?, ?, ?, ?)`
      )
      .run(id, userId, content, entities.join(" "));
  }
}

function mapMemory(row) {
  if (!row) return null;
  return {
    id: row.id,
    domain: row.domain,
    type: row.memory_type,
    content: row.content,
    entities: JSON.parse(row.entities_json),
    sourceMessageId: row.source_message_id,
    sourceExcerpt: row.source_excerpt || "",
    memoryKey: row.memory_key || "",
    mergeCount: row.merge_count || 1,
    source: row.source,
    confidence: row.confidence,
    importance: row.importance,
    sensitivity: row.sensitivity,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    lastConfirmedAt: row.last_confirmed_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { MemoryRepository };
