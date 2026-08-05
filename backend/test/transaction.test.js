const assert = require("node:assert/strict");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { runInSavepoint } = require("../src/infrastructure/transaction");

test("savepoint transactions nest without DatabaseSync.isTransaction", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE items(value TEXT NOT NULL)");
  database.exec("BEGIN IMMEDIATE");

  runInSavepoint(database, () => {
    database.prepare("INSERT INTO items(value) VALUES (?)").run("nested");
  });

  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM items").get().count, 1);
  database.exec("ROLLBACK");
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM items").get().count, 0);
  database.close();
});

test("savepoint rollback preserves its outer transaction", () => {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE items(value TEXT NOT NULL)");
  database.exec("BEGIN IMMEDIATE");
  database.prepare("INSERT INTO items(value) VALUES (?)").run("before");

  assert.throws(
    () =>
      runInSavepoint(database, () => {
        database.prepare("INSERT INTO items(value) VALUES (?)").run("discard");
        throw new Error("stop");
      }),
    /stop/
  );

  database.prepare("INSERT INTO items(value) VALUES (?)").run("after");
  database.exec("COMMIT");
  assert.deepEqual(
    database
      .prepare("SELECT value FROM items ORDER BY rowid")
      .all()
      .map((row) => row.value),
    ["before", "after"]
  );
  database.close();
});
