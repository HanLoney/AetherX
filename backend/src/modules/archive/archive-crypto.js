const crypto = require("node:crypto");
const fs = require("node:fs");
const { pipeline } = require("node:stream/promises");
const { Transform } = require("node:stream");
const zlib = require("node:zlib");

const ENVELOPE_MAGIC = Buffer.from("AETHERX-ARCHIVE\0", "ascii");
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = ENVELOPE_MAGIC.length + SALT_BYTES + IV_BYTES;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_DECRYPTED_BYTES = 8 * 1024 * 1024 * 1024 + 64 * 1024 * 1024;

async function encryptPayload(source, outputPath, password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const key = crypto.scryptSync(password, salt, 32, SCRYPT_OPTIONS);
  const header = Buffer.concat([ENVELOPE_MAGIC, salt, iv]);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(header);
  fs.writeFileSync(outputPath, header, { flag: "wx", mode: 0o600 });
  await pipeline(
    source,
    zlib.createGzip({ level: zlib.constants.Z_BEST_SPEED }),
    cipher,
    fs.createWriteStream(outputPath, { flags: "a", mode: 0o600 })
  );
  fs.appendFileSync(outputPath, cipher.getAuthTag());
}

async function decryptArchive(inputPath, outputPath, password) {
  const stat = fs.statSync(inputPath);
  if (stat.size <= HEADER_BYTES + TAG_BYTES) throw invalidArchive();
  const descriptor = fs.openSync(inputPath, "r");
  try {
    const header = Buffer.alloc(HEADER_BYTES);
    fs.readSync(descriptor, header, 0, header.length, 0);
    if (!header.subarray(0, ENVELOPE_MAGIC.length).equals(ENVELOPE_MAGIC)) {
      throw invalidArchive();
    }
    const salt = header.subarray(ENVELOPE_MAGIC.length, ENVELOPE_MAGIC.length + SALT_BYTES);
    const iv = header.subarray(ENVELOPE_MAGIC.length + SALT_BYTES);
    const tag = Buffer.alloc(TAG_BYTES);
    fs.readSync(descriptor, tag, 0, TAG_BYTES, stat.size - TAG_BYTES);
    const key = crypto.scryptSync(password, salt, 32, SCRYPT_OPTIONS);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(header);
    decipher.setAuthTag(tag);
    let decryptedBytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        decryptedBytes += chunk.length;
        if (decryptedBytes > MAX_DECRYPTED_BYTES) {
          const error = new Error("存档解压后的大小超出限制。");
          error.code = "ARCHIVE_TOO_LARGE";
          error.status = 413;
          callback(error);
        } else callback(null, chunk);
      }
    });
    await pipeline(
      fs.createReadStream(inputPath, {
        start: HEADER_BYTES,
        end: stat.size - TAG_BYTES - 1
      }),
      decipher,
      zlib.createGunzip(),
      limiter,
      fs.createWriteStream(outputPath, { flags: "wx", mode: 0o600 })
    );
  } catch (error) {
    fs.rmSync(outputPath, { force: true });
    if (error?.status && error?.code) throw error;
    const wrapped = new Error("存档密码错误，或存档文件已经损坏。");
    wrapped.code = "ARCHIVE_DECRYPT_FAILED";
    wrapped.status = 400;
    throw wrapped;
  } finally {
    fs.closeSync(descriptor);
  }
}

function invalidArchive() {
  const error = new Error("这不是有效的 AetherX 存档文件。");
  error.code = "INVALID_ARCHIVE";
  error.status = 400;
  return error;
}

module.exports = {
  HEADER_BYTES,
  decryptArchive,
  encryptPayload
};
