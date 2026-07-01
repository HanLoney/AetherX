const { randomUUID, createHash } = require("node:crypto");

class MemoryEvidenceRepository {
  constructor(database) {
    this.database = database;
  }

  hash(conversationId, evidence) {
    return createHash("sha256")
      .update(`${conversationId || ""}\n${normalizeEvidence(evidence)}`)
      .digest("hex");
  }

  add(userId, memoryId, input) {
    const evidence = String(input.evidence || "").trim().slice(0, 1000);
    if (!evidence) return null;
    const conversationId = String(input.conversationId || "").slice(0, 100);
    const evidenceHash =
      input.evidenceHash || this.hash(conversationId, evidence);
    this.database
      .prepare(`
        INSERT OR IGNORE INTO memory_evidence(
          id, user_id, memory_id, conversation_id, evidence, evidence_hash,
          confidence, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        randomUUID(),
        userId,
        memoryId,
        conversationId,
        evidence,
        evidenceHash,
        clamp(input.confidence),
        Date.now()
      );
    return { evidence, evidenceHash };
  }

  listByHash(userId, evidenceHash) {
    return this.database
      .prepare(`
        SELECT * FROM memory_evidence
        WHERE user_id = ? AND evidence_hash = ?
        ORDER BY created_at
      `)
      .all(userId, evidenceHash)
      .map(mapEvidence);
  }

  listForMemory(userId, memoryId) {
    return this.database
      .prepare(`
        SELECT * FROM memory_evidence
        WHERE user_id = ? AND memory_id = ?
        ORDER BY created_at
      `)
      .all(userId, memoryId)
      .map(mapEvidence);
  }
}

function mapEvidence(row) {
  return {
    id: row.id,
    memoryId: row.memory_id,
    conversationId: row.conversation_id,
    evidence: row.evidence,
    evidenceHash: row.evidence_hash,
    confidence: row.confidence,
    createdAt: row.created_at
  };
}

function normalizeEvidence(value) {
  return String(value).toLowerCase().replace(/[\s\p{P}\p{S}]/gu, "");
}

function clamp(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 0.5;
}

module.exports = { MemoryEvidenceRepository, normalizeEvidence };
