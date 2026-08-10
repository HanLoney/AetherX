const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const LOCK_FILE = ".aetherx-hub.lock";

function acquireDataDirLock(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const lockPath = path.join(dataDir, LOCK_FILE);
  const token = randomUUID();
  const handle = openLock(lockPath, token);
  let released = false;

  const release = () => {
    if (released) return;
    released = true;
    process.removeListener("exit", release);
    try { fs.closeSync(handle); } catch {}
    try {
      const current = readLock(lockPath);
      if (current?.token === token) fs.unlinkSync(lockPath);
    } catch {}
  };

  process.once("exit", release);
  return release;
}

function openLock(lockPath, token) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const handle = fs.openSync(lockPath, "wx");
      fs.writeFileSync(handle, JSON.stringify({
        pid: process.pid,
        token,
        startedAt: Date.now()
      }));
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readLock(lockPath);
      if (attempt === 0 && owner && !isProcessAlive(owner.pid)) {
        try { fs.unlinkSync(lockPath); } catch {}
        continue;
      }
      const locked = new Error(
        `AetherX Hub data directory is already in use${owner?.pid ? ` by process ${owner.pid}` : ""}: ${path.dirname(lockPath)}`
      );
      locked.code = "AETHERX_DATA_DIR_LOCKED";
      locked.details = { dataDir: path.dirname(lockPath), ownerPid: owner?.pid || null };
      throw locked;
    }
  }
  throw new Error(`Unable to lock AetherX Hub data directory: ${path.dirname(lockPath)}`);
}

function readLock(lockPath) {
  try {
    const value = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    return value && Number.isSafeInteger(Number(value.pid))
      ? { ...value, pid: Number(value.pid) }
      : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid) {
  if (!Number.isSafeInteger(Number(pid)) || Number(pid) < 1) return false;
  try {
    process.kill(Number(pid), 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

module.exports = { acquireDataDirLock, LOCK_FILE };
