const crypto = require("node:crypto");

const FORMAT_VERSION = 2;
const LEGACY_FORMAT_VERSION = 1;
const DIGEST_ALGORITHM = "sha256-canonical-codepoint-v2";
const CURRENT_USER = "__CURRENT_USER__";
const MAX_METADATA_BYTES = 64 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_MEDIA_BYTES = 256 * 1024 * 1024;

const TABLES = Object.freeze([
  "todos",
  "ai_configs",
  "conversations",
  "messages",
  "user_profiles",
  "user_preferences",
  "memories",
  "follow_ups",
  "memory_settings",
  "assistant_profiles",
  "assistant_personality_events",
  "shared_memories",
  "prompt_settings",
  "prompt_setting_versions",
  "memory_evidence",
  "assistant_journals",
  "xuan_mood_events",
  "xuan_mood_state",
  "xuan_mood_displays",
  "album_moments",
  "album_moment_sources",
  "assistant_dreams",
  "assistant_dream_sources",
  "ai_image_configs",
  "media_assets"
]);

const INSERT_ORDER = Object.freeze([
  "todos",
  "ai_configs",
  "user_profiles",
  "user_preferences",
  "memories",
  "follow_ups",
  "memory_settings",
  "assistant_profiles",
  "assistant_personality_events",
  "shared_memories",
  "prompt_settings",
  "prompt_setting_versions",
  "assistant_journals",
  "xuan_mood_events",
  "xuan_mood_state",
  "xuan_mood_displays",
  "album_moments",
  "album_moment_sources",
  "assistant_dreams",
  "assistant_dream_sources",
  "ai_image_configs",
  "conversations",
  "messages",
  "memory_evidence",
  "media_assets"
]);

function canonicalStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalStringify(value[key])}`).join(",")}}`;
}

function codePointCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function digestWithComparator({ records, credentials, account, media }, comparator) {
  const normalizedRecords = {};
  for (const table of TABLES) {
    normalizedRecords[table] = [...(records[table] || [])]
      .map(normalizeRow)
      .sort((left, right) => comparator(canonicalStringify(left), canonicalStringify(right)));
  }
  const normalizedMedia = [...(media || [])]
    .map(({ id, mimeType, fileName, byteSize, contentHash }) => ({
      id, mimeType, fileName, byteSize, contentHash
    }))
    .sort((left, right) => comparator(String(left.id), String(right.id)));
  return crypto.createHash("sha256").update(canonicalStringify({
    account: { displayName: String(account?.displayName || "") },
    credentials: {
      aiApiKey: String(credentials?.aiApiKey || ""),
      imageApiKey: String(credentials?.imageApiKey || "")
    },
    media: normalizedMedia,
    records: normalizedRecords
  })).digest("hex");
}

function continuityDigest(input) {
  return digestWithComparator(input, codePointCompare);
}

function legacyContinuityDigest(input) {
  return digestWithComparator(input, (left, right) => left.localeCompare(right));
}

function normalizeRow(row) {
  const copy = { ...row };
  if (Object.hasOwn(copy, "user_id")) copy.user_id = CURRENT_USER;
  if (Object.hasOwn(copy, "encrypted_api_key")) copy.encrypted_api_key = "";
  if (Object.hasOwn(copy, "preview_file_name")) copy.preview_file_name = "";
  if (Object.hasOwn(copy, "preview_byte_size")) copy.preview_byte_size = 0;
  return copy;
}

function encodeMetadata(metadata) {
  const bytes = Buffer.from(JSON.stringify(metadata), "utf8");
  if (bytes.length > MAX_METADATA_BYTES) throw archiveError(
    413,
    "ARCHIVE_METADATA_TOO_LARGE",
    "存档中的结构化数据过大。"
  );
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(bytes.length));
  return { bytes, length };
}

function readMetadata(payloadPath, fs) {
  const descriptor = fs.openSync(payloadPath, "r");
  try {
    const header = Buffer.alloc(8);
    if (fs.readSync(descriptor, header, 0, 8, 0) !== 8) throw invalidArchive();
    const length = Number(header.readBigUInt64BE());
    if (!Number.isSafeInteger(length) || length < 2 || length > MAX_METADATA_BYTES) {
      throw invalidArchive();
    }
    const bytes = Buffer.alloc(length);
    if (fs.readSync(descriptor, bytes, 0, length, 8) !== length) throw invalidArchive();
    let metadata;
    try {
      metadata = JSON.parse(bytes.toString("utf8"));
    } catch {
      throw invalidArchive();
    }
    return { metadata, mediaOffset: 8 + length };
  } finally {
    fs.closeSync(descriptor);
  }
}

function validateMetadata(metadata) {
  if (!metadata || ![LEGACY_FORMAT_VERSION, FORMAT_VERSION].includes(metadata.formatVersion)) {
    throw archiveError(400, "ARCHIVE_VERSION_UNSUPPORTED", "这个存档版本暂不受支持。");
  }
  if (!metadata.records || typeof metadata.records !== "object") throw invalidArchive();
  for (const table of TABLES) {
    if (!Array.isArray(metadata.records[table])) throw invalidArchive();
  }
  if (Object.keys(metadata.records).some((table) => !TABLES.includes(table))) throw invalidArchive();
  if (!Array.isArray(metadata.media)) throw invalidArchive();
  let total = 0;
  const ids = new Set();
  for (const item of metadata.media) {
    if (!item || typeof item.id !== "string" || ids.has(item.id)) throw invalidArchive();
    if (!Number.isSafeInteger(item.byteSize) || item.byteSize < 0 || item.byteSize > MAX_MEDIA_BYTES) {
      throw archiveError(413, "ARCHIVE_MEDIA_TOO_LARGE", "存档中有超出大小限制的媒体文件。");
    }
    if (!/^[a-f0-9]{64}$/i.test(String(item.contentHash || ""))) throw invalidArchive();
    if (!isSafeFileName(item.fileName)) throw invalidArchive();
    ids.add(item.id);
    total += item.byteSize;
    if (total > MAX_ARCHIVE_BYTES) {
      throw archiveError(413, "ARCHIVE_TOO_LARGE", "存档总大小超出限制。");
    }
  }
  const actualDigest = continuityDigest(metadata);
  if (metadata.formatVersion === LEGACY_FORMAT_VERSION && !metadata.digestAlgorithm) {
    if (!/^[a-f0-9]{64}$/i.test(String(metadata.continuityDigest || ""))) throw invalidArchive();
    // Version 1 sorted rows with localeCompare(), whose result changes across
    // Node/Electron ICU versions and OS locales. The encrypted envelope already
    // authenticates the whole payload, and media is verified separately, so
    // normalize legacy archives to the deterministic digest before restoring.
    metadata.continuityDigest = actualDigest;
    metadata.digestAlgorithm = DIGEST_ALGORITHM;
  } else if (metadata.digestAlgorithm !== DIGEST_ALGORITHM) {
    throw archiveError(400, "ARCHIVE_DIGEST_UNSUPPORTED", "这个存档使用了当前版本不支持的一致性校验方式。");
  } else if (actualDigest !== metadata.continuityDigest) {
    throw archiveError(400, "ARCHIVE_DIGEST_MISMATCH", "存档一致性校验失败。");
  }
  return metadata;
}

function isSafeFileName(value) {
  if (typeof value !== "string" || value.length < 1 || value.length > 180) return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value) || value.endsWith(".") || value.includes("..")) {
    return false;
  }
  const base = value.split(".")[0].toUpperCase();
  return !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/.test(base);
}

function invalidArchive() {
  return archiveError(400, "INVALID_ARCHIVE", "这不是有效的 AetherX 存档文件。");
}

function archiveError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

module.exports = {
  CURRENT_USER,
  DIGEST_ALGORITHM,
  FORMAT_VERSION,
  INSERT_ORDER,
  MAX_ARCHIVE_BYTES,
  TABLES,
  archiveError,
  continuityDigest,
  encodeMetadata,
  normalizeRow,
  legacyContinuityDigest,
  readMetadata,
  validateMetadata
};
