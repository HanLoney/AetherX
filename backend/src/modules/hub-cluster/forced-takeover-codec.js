const { createHmac, timingSafeEqual } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");
const {
  canonicalStringify,
  sha256Canonical
} = require("../replication/operation-codec");

const FORCED_TAKEOVER_VERSION = 1;

function signForcedTakeover(input, key) {
  const proof = normalizeProof(input);
  return {
    proof,
    authenticationTag: hmac(proof, key)
  };
}

function verifyForcedTakeover(signed, key, now = Date.now()) {
  const proof = normalizeProof(signed?.proof);
  if (!safeTag(signed?.authenticationTag, hmac(proof, key))) {
    throw invalidProof("强制接管证明认证失败。");
  }
  if (proof.issuedAt > Number(now) + 5 * 60_000) {
    throw invalidProof("强制接管证明的签发时间无效。");
  }
  return proof;
}

function normalizeProof(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidProof("强制接管证明必须是对象。");
  }
  const version = integer(input.version ?? FORCED_TAKEOVER_VERSION, "version", 1);
  if (version !== FORCED_TAKEOVER_VERSION) {
    throw invalidProof("强制接管证明版本不受支持。");
  }
  const previousEpoch = integer(input.previousEpoch, "previousEpoch", 1);
  const epoch = integer(input.epoch, "epoch", 2);
  if (epoch !== previousEpoch + 1) {
    throw invalidProof("强制接管必须且只能提升一个 Hub 代次。");
  }
  const integrity = input.integrity;
  if (!integrity || typeof integrity !== "object" || Array.isArray(integrity)) {
    throw invalidProof("强制接管缺少完整性快照。");
  }
  return {
    version,
    action: exact(input.action, "forced_takeover", "action"),
    spaceId: identifier(input.spaceId, "spaceId"),
    previousEpoch,
    epoch,
    previousActiveNodeId: identifier(input.previousActiveNodeId, "previousActiveNodeId"),
    activeNodeId: identifier(input.activeNodeId, "activeNodeId"),
    takeoverId: identifier(input.takeoverId, "takeoverId"),
    integrity: {
      snapshotId: identifier(integrity.snapshotId, "integrity.snapshotId"),
      recordsRoot: hash(integrity.recordsRoot, "integrity.recordsRoot"),
      recordCount: integer(integrity.recordCount, "integrity.recordCount", 0),
      verifiedAt: integer(integrity.verifiedAt, "integrity.verifiedAt", 0)
    },
    operationHeads: normalizeOperationHeads(input.operationHeads),
    issuedAt: integer(input.issuedAt, "issuedAt", 0)
  };
}

function normalizeOperationHeads(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidProof("强制接管缺少 Operation 链头。");
  }
  return Object.fromEntries(Object.entries(input)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([nodeId, head]) => {
      if (!head || typeof head !== "object" || Array.isArray(head)) {
        throw invalidProof("Operation 链头无效。");
      }
      const sequence = integer(head.sequence, `operationHeads.${nodeId}.sequence`, 0);
      const operationHash = String(head.operationHash || "").toLowerCase();
      if ((sequence === 0 && operationHash !== "") ||
          (sequence > 0 && !/^[a-f0-9]{64}$/.test(operationHash))) {
        throw invalidProof("Operation 链头哈希无效。");
      }
      return [identifier(nodeId, "operationHeads.nodeId"), { sequence, operationHash }];
    }));
}

function proofHash(proof) {
  return sha256Canonical(normalizeProof(proof));
}

function hmac(value, key) {
  return createHmac("sha256", key)
    .update(canonicalStringify(value), "utf8")
    .digest("hex");
}

function safeTag(left, right) {
  const received = String(left || "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(received) &&
    timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(right, "hex"));
}

function identifier(value, field) {
  const result = String(value || "").trim();
  if (!result || result.length > 256 || /[\u0000-\u001f]/.test(result)) {
    throw invalidProof(`强制接管字段 ${field} 无效。`);
  }
  return result;
}

function integer(value, field, minimum) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw invalidProof(`强制接管字段 ${field} 必须是安全整数。`);
  }
  return result;
}

function hash(value, field) {
  const result = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw invalidProof(`强制接管字段 ${field} 不是有效哈希。`);
  }
  return result;
}

function exact(value, expected, field) {
  if (String(value || "") !== expected) {
    throw invalidProof(`强制接管字段 ${field} 无效。`);
  }
  return expected;
}

function invalidProof(message) {
  return new HttpError(409, "FORCED_TAKEOVER_INVALID", message);
}

module.exports = {
  FORCED_TAKEOVER_VERSION,
  proofHash,
  signForcedTakeover,
  verifyForcedTakeover
};
