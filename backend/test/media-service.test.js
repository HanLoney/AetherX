const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const jpeg = require("jpeg-js");
const { openDatabase } = require("../src/infrastructure/database");
const { MediaRepository } = require("../src/modules/media/media-repository");
const { MediaService } = require("../src/modules/media/media-service");

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

test("legacy conversation images migrate from JSON into deduplicated media files", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-media-"));
  const database = openDatabase(dataDir);
  try {
    const now = Date.now();
    database.prepare(
      `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("user-1", "media-user", "Media User", "hash", now, now);
    database.prepare(
      `INSERT INTO conversations(id, user_id, title, summary, created_at, updated_at)
       VALUES (?, ?, ?, '', ?, ?)`
    ).run("conversation-1", "user-1", "Media", now, now);
    const insert = database.prepare(
      `INSERT INTO messages(
        id, conversation_id, stream_type, position, role, content, payload_json, created_at
       ) VALUES (?, ?, 'display', ?, 'tool', '', ?, ?)`
    );
    const payload = JSON.stringify({ image: { source: PNG, description: "tiny" } });
    insert.run("message-1", "conversation-1", 0, payload, now);
    insert.run("message-2", "conversation-1", 1, payload, now + 1);

    const service = new MediaService(new MediaRepository(database), dataDir);
    assert.equal(service.migrateLegacyConversationImages(), 2);
    const rows = database.prepare(
      "SELECT payload_json FROM messages ORDER BY id"
    ).all().map((row) => JSON.parse(row.payload_json));
    assert.equal(rows[0].image.source, undefined);
    assert.equal(rows[0].image.mediaId, rows[1].image.mediaId);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM media_assets").get().count, 1);
    assert.equal(fs.readdirSync(path.join(dataDir, "media")).length, 1);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("large JPEG media gets a cached lightweight preview while preserving the original", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-preview-"));
  const database = openDatabase(dataDir);
  try {
    const now = Date.now();
    database.prepare(
      `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run("user-2", "preview-user", "Preview User", "hash", now, now);
    const width = 900;
    const height = 1200;
    const pixels = Buffer.alloc(width * height * 4);
    for (let index = 0; index < width * height; index += 1) {
      pixels[index * 4] = index % 251;
      pixels[index * 4 + 1] = Math.floor(index / width) % 251;
      pixels[index * 4 + 2] = Math.floor(index / 17) % 251;
      pixels[index * 4 + 3] = 255;
    }
    const originalBytes = jpeg.encode({ data: pixels, width, height }, 92).data;
    const service = new MediaService(new MediaRepository(database), dataDir);
    const asset = service.storeDataUrl(
      "user-2",
      `data:image/jpeg;base64,${originalBytes.toString("base64")}`
    );

    assert.ok(asset.previewByteSize > 0);
    const preview = service.open("user-2", asset.id, "preview");
    const decodedPreview = jpeg.decode(fs.readFileSync(preview.filePath), {
      useTArray: true
    });
    assert.equal(Math.max(decodedPreview.width, decodedPreview.height), 720);
    assert.ok(preview.byteSize < asset.byteSize);
    assert.notEqual(preview.filePath, service.open("user-2", asset.id).filePath);
    assert.equal(
      service.open("user-2", asset.id, "preview").filePath,
      preview.filePath
    );
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
