const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const {
  acquireDataDirLock,
  LOCK_FILE
} = require("../src/infrastructure/data-dir-lock");

test("data directory lock rejects a second Hub writer", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-lock-"));
  const release = acquireDataDirLock(dataDir);
  try {
    assert.throws(
      () => acquireDataDirLock(dataDir),
      (error) => error?.code === "AETHERX_DATA_DIR_LOCKED"
    );
  } finally {
    release();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("data directory lock replaces a stale owner and releases cleanly", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-lock-stale-"));
  fs.writeFileSync(path.join(dataDir, LOCK_FILE), JSON.stringify({
    pid: 2147483647,
    token: "stale"
  }));
  const release = acquireDataDirLock(dataDir);
  release();
  assert.equal(fs.existsSync(path.join(dataDir, LOCK_FILE)), false);
  fs.rmSync(dataDir, { recursive: true, force: true });
});
