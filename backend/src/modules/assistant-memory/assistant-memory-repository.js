const { randomUUID } = require("node:crypto");

class AssistantMemoryRepository {
  constructor(database) {
    this.database = database;
  }

  getProfile(userId) {
    const row = this.database
      .prepare("SELECT * FROM assistant_profiles WHERE user_id = ?")
      .get(userId);
    return row ? mapProfile(row) : defaultProfile();
  }

  saveProfile(userId, profile) {
    const now = Date.now();
    this.database.prepare(`
      INSERT INTO assistant_profiles(
        user_id, name, gender, self_definition, relationship_summary,
        traits_json, values_json, avatar_data_url, persona_image_data_url,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        name = excluded.name,
        gender = excluded.gender,
        self_definition = excluded.self_definition,
        relationship_summary = excluded.relationship_summary,
        traits_json = excluded.traits_json,
        values_json = excluded.values_json,
        avatar_data_url = excluded.avatar_data_url,
        persona_image_data_url = excluded.persona_image_data_url,
        updated_at = excluded.updated_at
    `).run(
      userId,
      profile.name,
      profile.gender,
      profile.selfDefinition,
      profile.relationshipSummary,
      JSON.stringify(profile.traits),
      JSON.stringify(profile.values),
      profile.avatarDataUrl,
      profile.personaImageDataUrl,
      now
    );
    return this.getProfile(userId);
  }

  listEvents(userId, status = "") {
    const rows = status
      ? this.database
          .prepare(
            "SELECT * FROM assistant_personality_events WHERE user_id = ? AND status = ? ORDER BY created_at DESC"
          )
          .all(userId, status)
      : this.database
          .prepare(
            "SELECT * FROM assistant_personality_events WHERE user_id = ? ORDER BY created_at DESC"
          )
          .all(userId);
    return rows.map(mapEvent);
  }

  createEvent(userId, event) {
    const id = randomUUID();
    const createdAt = Date.now();
    this.database.prepare(`
      INSERT INTO assistant_personality_events(
        id, user_id, category, trait_key, trait_value, content, evidence,
        source_role, confidence, weight, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      event.category,
      event.traitKey,
      event.traitValue,
      event.content,
      event.evidence,
      event.sourceRole,
      event.confidence,
      event.weight,
      event.status,
      createdAt
    );
    return mapEvent(
      this.database
        .prepare("SELECT * FROM assistant_personality_events WHERE id = ?")
        .get(id)
    );
  }

  deleteEvent(userId, id) {
    return this.database
      .prepare(
        "DELETE FROM assistant_personality_events WHERE id = ? AND user_id = ?"
      )
      .run(id, userId).changes > 0;
  }

  confirmEvent(userId, id) {
    this.database
      .prepare(
        "UPDATE assistant_personality_events SET status = 'active' WHERE id = ? AND user_id = ?"
      )
      .run(id, userId);
    const row = this.database
      .prepare(
        "SELECT * FROM assistant_personality_events WHERE id = ? AND user_id = ?"
      )
      .get(id, userId);
    return row ? mapEvent(row) : null;
  }

  listSharedMemories(userId, status = "") {
    const rows = status
      ? this.database
          .prepare(
            "SELECT * FROM shared_memories WHERE user_id = ? AND status = ? ORDER BY updated_at DESC"
          )
          .all(userId, status)
      : this.database
          .prepare(
            "SELECT * FROM shared_memories WHERE user_id = ? ORDER BY updated_at DESC"
          )
          .all(userId);
    return rows.map(mapSharedMemory);
  }

  createSharedMemory(userId, memory) {
    const id = randomUUID();
    const now = Date.now();
    this.database.prepare(`
      INSERT INTO shared_memories(
        id, user_id, memory_type, content, participants_json, evidence,
        source, confidence, importance, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      userId,
      memory.type,
      memory.content,
      JSON.stringify(memory.participants),
      memory.evidence,
      memory.source,
      memory.confidence,
      memory.importance,
      memory.status,
      now,
      now
    );
    return mapSharedMemory(
      this.database
        .prepare("SELECT * FROM shared_memories WHERE id = ?")
        .get(id)
    );
  }

  deleteSharedMemory(userId, id) {
    return this.database
      .prepare("DELETE FROM shared_memories WHERE id = ? AND user_id = ?")
      .run(id, userId).changes > 0;
  }

  confirmSharedMemory(userId, id) {
    this.database
      .prepare(
        "UPDATE shared_memories SET status = 'active', updated_at = ? WHERE id = ? AND user_id = ?"
      )
      .run(Date.now(), id, userId);
    const row = this.database
      .prepare("SELECT * FROM shared_memories WHERE id = ? AND user_id = ?")
      .get(id, userId);
    return row ? mapSharedMemory(row) : null;
  }
}

function defaultProfile() {
  return {
    name: "小玄",
    gender: "女",
    selfDefinition: "会持续成长的全能助手",
    relationshipSummary: "洛尼亲密无间的伙伴和得力编程助手",
    traits: [],
    values: [],
    avatarDataUrl: "",
    personaImageDataUrl: "",
    updatedAt: null
  };
}

function mapProfile(row) {
  return {
    name: row.name,
    gender: row.gender,
    selfDefinition: row.self_definition,
    relationshipSummary: row.relationship_summary,
    traits: JSON.parse(row.traits_json),
    values: JSON.parse(row.values_json),
    avatarDataUrl: row.avatar_data_url || "",
    personaImageDataUrl: row.persona_image_data_url || "",
    updatedAt: row.updated_at
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    category: row.category,
    traitKey: row.trait_key,
    traitValue: row.trait_value,
    content: row.content,
    evidence: row.evidence,
    sourceRole: row.source_role,
    confidence: row.confidence,
    weight: row.weight,
    status: row.status,
    createdAt: row.created_at
  };
}

function mapSharedMemory(row) {
  return {
    id: row.id,
    type: row.memory_type,
    content: row.content,
    participants: JSON.parse(row.participants_json),
    evidence: row.evidence,
    source: row.source,
    confidence: row.confidence,
    importance: row.importance,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

module.exports = { AssistantMemoryRepository };
