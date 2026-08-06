const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { openDatabase } = require("../src/infrastructure/database");
const {
  ConversationRepository
} = require("../src/modules/conversations/conversation-repository");
const {
  ConversationService
} = require("../src/modules/conversations/conversation-service");

test("conversation repository merges legacy conversations into one primary conversation", () => {
  withDatabase((database) => {
    const userId = "single-conversation-user";
    createUser(database, userId);
    const repository = new ConversationRepository(database);
    const older = repository.create(userId, "Old conversation");
    const middle = repository.create(userId, "Middle conversation");
    const primary = repository.create(userId, "Primary conversation");
    repository.upsertMessages(older.id, [
      message("display-old", "display", 8, 30),
      message("model-old", "model", 9, 5)
    ]);
    repository.upsertMessages(middle.id, [message("display-middle", "display", 4, 10)]);
    repository.upsertMessages(primary.id, [
      message("display-primary", "display", 3, 20),
      message("model-primary", "model", 2, 5)
    ]);
    database.prepare("UPDATE conversations SET updated_at = 100 WHERE id = ?").run(older.id);
    database.prepare("UPDATE conversations SET updated_at = 200 WHERE id = ?").run(middle.id);
    database.prepare("UPDATE conversations SET updated_at = 300 WHERE id = ?").run(primary.id);
    database.prepare(
      `INSERT INTO memories(
         id, user_id, domain, memory_type, content, source, confidence,
         importance, sensitivity, status, created_at, updated_at
       ) VALUES ('memory-1', ?, 'life', 'fact', 'legacy evidence', 'explicit', 1, 1,
                 'normal', 'active', 1, 1)`
    ).run(userId);
    database.prepare(
      `INSERT INTO memory_evidence(
         id, user_id, memory_id, conversation_id, evidence, evidence_hash,
         confidence, created_at
       ) VALUES ('evidence-1', ?, 'memory-1', ?, 'legacy evidence', ?, 1, 1)`
    ).run(userId, older.id, "a".repeat(64));
    const service = new ConversationService(repository);

    const merged = service.mergeIntoPrimary(userId);

    assert.equal(merged.primary.id, primary.id);
    assert.deepEqual(merged.removedConversations.map((item) => item.id), [middle.id, older.id]);
    assert.deepEqual(repository.list(userId).map((item) => item.id), [primary.id]);
    assert.deepEqual(
      repository.messages(primary.id).map((item) => [item.id, item.stream, item.position]),
      [
        ["display-middle", "display", 0],
        ["display-primary", "display", 1],
        ["display-old", "display", 2],
        ["model-primary", "model", 0],
        ["model-old", "model", 1]
      ]
    );
    assert.equal(
      database.prepare("SELECT conversation_id FROM memory_evidence WHERE id = 'evidence-1'").get().conversation_id,
      primary.id
    );
    assert.deepEqual(service.mergeIntoPrimary(userId), {
      primary: repository.primary(userId),
      messages: [],
      evidence: [],
      removedConversations: []
    });
    assert.equal(service.create(userId, { title: "Must not create" }).id, primary.id);
  });
});

test("conversation service restores the persisted message creation time", () => {
  withDatabase((database) => {
    const userId = "message-timestamp-user";
    createUser(database, userId);
    const repository = new ConversationRepository(database);
    const conversation = repository.create(userId, "Timestamp conversation");
    repository.upsertMessages(conversation.id, [
      {
        id: "timestamp-message",
        stream: "display",
        position: 0,
        role: "assistant",
        content: "Timestamped reply",
        payload: { createdAt: 999 },
        createdAt: 123
      }
    ]);

    const restored = new ConversationService(repository).get(userId, conversation.id);

    assert.equal(restored.displayMessages[0].createdAt, 123);
  });
});

function message(id, stream, position, createdAt) {
  return { id, stream, position, role: "assistant", content: id, payload: {}, createdAt };
}

function withDatabase(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-conversation-"));
  const database = openDatabase(dataDir);
  try {
    run(database);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function createUser(database, id) {
  database.prepare(
    `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'test-password-hash', 1, 1)`
  ).run(id, id, id);
}
