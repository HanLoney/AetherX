const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  openDatabase,
  supportsFts5
} = require("../src/infrastructure/database");
const {
  MemoryRepository
} = require("../src/modules/memories/memory-repository");

test("memory storage and search work when SQLite does not provide FTS5", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-no-fts5-"));
  const database = openDatabase(dataDir, { fullTextSearch: false });
  try {
    assert.equal(supportsFts5(database), false);
    assert.equal(
      database
        .prepare(
          "SELECT name FROM sqlite_schema WHERE type = 'table' AND name = 'memories_fts'"
        )
        .get(),
      undefined
    );

    const repository = new MemoryRepository(database);
    const created = repository.create("user-1", {
      domain: "life",
      type: "fact",
      content: "用户每天六点半下班",
      entities: ["下班时间"],
      sourceMessageId: null,
      sourceExcerpt: "六点半下班",
      memoryKey: "work.end_time",
      mergeCount: 1,
      source: "explicit",
      confidence: 1,
      importance: 0.8,
      sensitivity: "normal",
      validFrom: null,
      validUntil: null,
      status: "active"
    });

    assert.deepEqual(
      repository.search("user-1", "几点下班").map((memory) => memory.id),
      [created.id]
    );

    repository.update("user-1", created.id, {
      content: "用户通常晚上七点下班"
    });
    assert.equal(repository.search("user-1", "七点下班")[0].id, created.id);
    assert.equal(repository.delete("user-1", created.id), 1);
    assert.deepEqual(repository.search("user-1", "下班"), []);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
