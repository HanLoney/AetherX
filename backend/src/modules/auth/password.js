const { randomBytes, scrypt: scryptCallback, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;

async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(String(password), salt, KEY_LENGTH);
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

async function verifyPassword(password, storedHash) {
  const parts = String(storedHash || "").split("$");
  const validFormat = parts.length === 3 && parts[0] === "scrypt";
  const salt = validFormat ? decode(parts[1], 16) : Buffer.alloc(16);
  const expected = validFormat ? decode(parts[2], KEY_LENGTH) : Buffer.alloc(KEY_LENGTH);
  const derived = await scrypt(String(password), salt, KEY_LENGTH);
  return validFormat && timingSafeEqual(derived, expected);
}

function decode(value, length) {
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.length === length ? decoded : Buffer.alloc(length);
  } catch {
    return Buffer.alloc(length);
  }
}

module.exports = { hashPassword, verifyPassword };
