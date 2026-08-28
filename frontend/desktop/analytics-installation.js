const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

function loadAnalyticsInstallationId(filePath) {
  try {
    const stored = fs.readFileSync(filePath, "utf8").trim();
    if (/^[A-Za-z0-9._:-]{8,100}$/.test(stored)) return stored;
  } catch { /* create below */ }
  const id = `desktop-${randomUUID()}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  fs.writeFileSync(temporaryPath, id, { mode: 0o600 });
  fs.renameSync(temporaryPath, filePath);
  return id;
}

module.exports = { loadAnalyticsInstallationId };
