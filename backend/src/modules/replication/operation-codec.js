const {
  createHash,
  createHmac,
  timingSafeEqual
} = require("node:crypto");
const { HttpError } = require("../../lib/http-error");

const OPERATION_PROTOCOL_VERSION = 1;
const OPERATION_TYPES = new Set(["upsert", "delete", "reset_marker", "control"]);
const HASH_PATTERN = /^[a-f0-9]{64}$/;

function canonicalStringify(value) {
  return stringifyCanonical(value, new Set());
}

function sha256Canonical(value) {
  return createHash("sha256").update(canonicalStringify(value), "utf8").digest("hex");
}

function buildOperation(input, options = {}) {
  const operation = normalizeOperationInput(input);
  operation.payloadHash = sha256Canonical(operation.payload);
  operation.operationHash = sha256Canonical(operationHashMaterial(operation));
  operation.authenticationTag = options.syncKey
    ? authenticationTag(operation.operationHash, options.syncKey)
    : "";
  return operation;
}

function validateOperation(input, options = {}) {
  const operation = normalizeOperationInput(input, { requireHashes: true });
  const expectedPayloadHash = sha256Canonical(operation.payload);
  if (operation.payloadHash !== expectedPayloadHash) {
    throw invalidOperation("复制操作的 Payload 校验失败。", "payloadHash");
  }
  const expectedOperationHash = sha256Canonical(operationHashMaterial(operation));
  if (operation.operationHash !== expectedOperationHash) {
    throw invalidOperation("复制操作的哈希链校验失败。", "operationHash");
  }
  if (options.syncKey) {
    const expectedTag = authenticationTag(operation.operationHash, options.syncKey);
    if (!safeEqual(operation.authenticationTag, expectedTag)) {
      throw invalidOperation("复制操作的认证标签无效。", "authenticationTag");
    }
  }
  return operation;
}

function signOperation(input, syncKey) {
  const operation = validateOperation(input);
  return {
    ...operation,
    authenticationTag: authenticationTag(operation.operationHash, syncKey)
  };
}

function operationHashMaterial(operation) {
  return {
    protocolVersion: operation.protocolVersion,
    operationId: operation.operationId,
    spaceId: operation.spaceId,
    originNodeId: operation.originNodeId,
    originSequence: operation.originSequence,
    epoch: operation.epoch,
    entityType: operation.entityType,
    entityId: operation.entityId,
    operation: operation.operation,
    entityVersion: operation.entityVersion,
    previousEntityVersion: operation.previousEntityVersion,
    payload: operation.payload,
    payloadHash: operation.payloadHash,
    previousOperationHash: operation.previousOperationHash,
    createdAt: operation.createdAt
  };
}

function normalizeOperationInput(input, options = {}) {
  if (!isPlainObject(input)) throw invalidOperation("复制操作必须是对象。", "operation");
  const operation = {
    protocolVersion: integer(input.protocolVersion, "protocolVersion", 1),
    operationId: identifier(input.operationId, "operationId"),
    spaceId: identifier(input.spaceId, "spaceId"),
    originNodeId: identifier(input.originNodeId, "originNodeId"),
    originSequence: integer(input.originSequence, "originSequence", 1),
    epoch: integer(input.epoch, "epoch", 1),
    entityType: identifier(input.entityType, "entityType"),
    entityId: identifier(input.entityId, "entityId"),
    operation: operationType(input.operation),
    entityVersion: integer(input.entityVersion, "entityVersion", 1),
    previousEntityVersion: optionalInteger(
      input.previousEntityVersion,
      "previousEntityVersion",
      1
    ),
    payload: canonicalPayload(input.payload),
    payloadHash: String(input.payloadHash || "").toLowerCase(),
    previousOperationHash: String(input.previousOperationHash || "").toLowerCase(),
    operationHash: String(input.operationHash || "").toLowerCase(),
    authenticationTag: String(input.authenticationTag || "").toLowerCase(),
    createdAt: integer(input.createdAt, "createdAt", 0)
  };
  if (operation.protocolVersion !== OPERATION_PROTOCOL_VERSION) {
    throw new HttpError(
      426,
      "REPLICATION_PROTOCOL_UNSUPPORTED",
      "复制操作使用了当前 Hub 不支持的协议版本。",
      { protocolVersion: operation.protocolVersion }
    );
  }
  if (operation.previousOperationHash && !HASH_PATTERN.test(operation.previousOperationHash)) {
    throw invalidOperation("前序操作哈希格式无效。", "previousOperationHash");
  }
  if (options.requireHashes) {
    requireHash(operation.payloadHash, "payloadHash");
    requireHash(operation.operationHash, "operationHash");
    if (operation.authenticationTag) requireHash(operation.authenticationTag, "authenticationTag");
  }
  return operation;
}

function canonicalPayload(value) {
  if (!isPlainObject(value)) {
    throw invalidOperation("复制操作的 Payload 必须是对象。", "payload");
  }
  canonicalStringify(value);
  return cloneJson(value);
}

function stringifyCanonical(value, seen) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw invalidCanonical("只允许有限数值。");
    return JSON.stringify(value);
  }
  if (typeof value !== "object") throw invalidCanonical("包含非 JSON 数据类型。");
  if (seen.has(value)) throw invalidCanonical("不能包含循环引用。");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(value, index)) throw invalidCanonical("数组不能包含空位。");
        items.push(stringifyCanonical(value[index], seen));
      }
      return `[${items.join(",")}]`;
    }
    if (!isPlainObject(value)) throw invalidCanonical("只允许普通 JSON 对象。");
    const keys = Object.keys(value).sort(codePointCompare);
    return `{${keys.map((key) => {
      const item = value[key];
      if (item === undefined) throw invalidCanonical(`字段 ${key} 不能是 undefined。`);
      return `${JSON.stringify(key)}:${stringifyCanonical(item, seen)}`;
    }).join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

function codePointCompare(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function identifier(value, field) {
  const result = String(value || "").trim();
  if (!result || result.length > 256 || /[\u0000-\u001f]/.test(result)) {
    throw invalidOperation(`复制操作字段 ${field} 无效。`, field);
  }
  return result;
}

function integer(value, field, minimum) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw invalidOperation(`复制操作字段 ${field} 必须是安全整数。`, field);
  }
  return result;
}

function optionalInteger(value, field, minimum) {
  if (value === null || value === undefined) return null;
  return integer(value, field, minimum);
}

function operationType(value) {
  const result = String(value || "");
  if (!OPERATION_TYPES.has(result)) {
    throw invalidOperation("复制操作类型无效。", "operation");
  }
  return result;
}

function requireHash(value, field) {
  if (!HASH_PATTERN.test(value)) throw invalidOperation(`复制操作字段 ${field} 不是有效哈希。`, field);
}

function authenticationTag(operationHash, syncKey) {
  const key = Buffer.isBuffer(syncKey) ? syncKey : Buffer.from(String(syncKey), "utf8");
  if (!key.length) throw invalidOperation("同步认证密钥不能为空。", "syncKey");
  return createHmac("sha256", key).update(operationHash, "utf8").digest("hex");
}

function safeEqual(left, right) {
  if (!HASH_PATTERN.test(left) || !HASH_PATTERN.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function isPlainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function invalidCanonical(message) {
  return new TypeError(`无法规范化复制数据：${message}`);
}

function invalidOperation(message, field) {
  return new HttpError(400, "REPLICATION_OPERATION_INVALID", message, { field });
}

module.exports = {
  OPERATION_PROTOCOL_VERSION,
  buildOperation,
  canonicalStringify,
  sha256Canonical,
  signOperation,
  validateOperation
};
