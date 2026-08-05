const { createHmac, timingSafeEqual } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");
const {
  canonicalStringify,
  sha256Canonical
} = require("../replication/operation-codec");

const CONTROL_VERSION = 1;
const SWITCH_PHASES = Object.freeze([
  "preparing_switch",
  "draining",
  "final_sync",
  "integrity_check",
  "committing_switch"
]);
const ACTIONS = new Set(["phase", "commit", "abort"]);

function signSwitchControl(input, key) {
  const control = normalizeControl(input);
  return {
    control,
    authenticationTag: hmac(control, key)
  };
}

function verifySwitchControl(signed, key, now = Date.now()) {
  const control = normalizeControl(signed?.control);
  if (!safeTag(signed?.authenticationTag, hmac(control, key))) {
    throw invalidControl("切换控制消息认证失败。");
  }
  if (Math.abs(Number(now) - control.issuedAt) > 30_000) {
    throw invalidControl("切换控制消息已经过期。");
  }
  return control;
}

function signSwitchAck(input, key) {
  const ack = normalizeAck(input);
  return { ack, authenticationTag: hmac(ack, key) };
}

function verifySwitchAck(signed, key, expected = {}) {
  const ack = normalizeAck(signed?.ack);
  if (!safeTag(signed?.authenticationTag, hmac(ack, key))) {
    throw invalidControl("切换确认消息认证失败。");
  }
  if (
    (expected.controlHash && ack.controlHash !== expected.controlHash) ||
    (expected.nodeId && ack.nodeId !== expected.nodeId) ||
    (expected.state && ack.state !== expected.state) ||
    (expected.epoch !== undefined && ack.epoch !== Number(expected.epoch)) ||
    (expected.stateHash && ack.stateHash !== expected.stateHash)
  ) {
    throw invalidControl("切换确认消息与当前控制阶段不匹配。");
  }
  return ack;
}

function persistedState(control) {
  if (control.action === "phase") {
    return {
      spaceId: control.spaceId,
      epoch: control.epoch,
      activeNodeId: control.activeNodeId,
      transitionId: control.transitionId,
      transitionTargetNodeId: control.targetNodeId,
      transitionStartedAt: control.transitionStartedAt,
      state: control.state
    };
  }
  if (control.action === "abort") {
    return {
      spaceId: control.spaceId,
      epoch: control.epoch,
      activeNodeId: control.activeNodeId,
      transitionId: "",
      transitionTargetNodeId: "",
      transitionStartedAt: null,
      state: "stable"
    };
  }
  return {
    spaceId: control.spaceId,
    epoch: control.epoch,
    activeNodeId: control.targetNodeId,
    transitionId: "",
    transitionTargetNodeId: "",
    transitionStartedAt: null,
    state: "stable"
  };
}

function stateHash(state) {
  return sha256Canonical({
    spaceId: state.spaceId,
    epoch: state.epoch,
    activeNodeId: state.activeNodeId,
    transitionId: state.transitionId,
    transitionTargetNodeId: state.transitionTargetNodeId,
    transitionStartedAt: state.transitionStartedAt,
    state: state.state
  });
}

function controlHash(control) {
  return sha256Canonical(normalizeControl(control));
}

function normalizeControl(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidControl("切换控制消息必须是对象。");
  }
  const action = String(input.action || "");
  if (!ACTIONS.has(action)) throw invalidControl("切换控制动作无效。");
  const state = String(input.state || "");
  if (action === "phase" && !SWITCH_PHASES.includes(state)) {
    throw invalidControl("切换控制阶段无效。");
  }
  if (action !== "phase" && state !== "stable") {
    throw invalidControl("提交或中止控制必须回到 stable。");
  }
  const transitionStartedAt = integer(
    input.transitionStartedAt,
    "transitionStartedAt",
    0
  );
  const version = integer(input.version ?? CONTROL_VERSION, "version", 1);
  if (version !== CONTROL_VERSION) {
    throw invalidControl("切换控制协议版本不受支持。");
  }
  return {
    version,
    action,
    spaceId: identifier(input.spaceId, "spaceId"),
    epoch: integer(input.epoch, "epoch", 1),
    activeNodeId: identifier(input.activeNodeId, "activeNodeId"),
    targetNodeId: identifier(input.targetNodeId, "targetNodeId"),
    transitionId: identifier(input.transitionId, "transitionId"),
    transitionStartedAt,
    state,
    issuedAt: integer(input.issuedAt, "issuedAt", 0)
  };
}

function normalizeAck(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw invalidControl("切换确认消息必须是对象。");
  }
  const version = integer(input.version ?? CONTROL_VERSION, "version", 1);
  if (version !== CONTROL_VERSION) {
    throw invalidControl("切换确认协议版本不受支持。");
  }
  const state = String(input.state || "");
  if (state !== "stable" && !SWITCH_PHASES.includes(state)) {
    throw invalidControl("切换确认阶段无效。");
  }
  return {
    version,
    controlHash: hash(input.controlHash, "controlHash"),
    nodeId: identifier(input.nodeId, "nodeId"),
    state,
    epoch: integer(input.epoch, "epoch", 1),
    stateHash: hash(input.stateHash, "stateHash"),
    appliedAt: integer(input.appliedAt, "appliedAt", 0)
  };
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
    throw invalidControl(`切换控制字段 ${field} 无效。`);
  }
  return result;
}

function integer(value, field, minimum) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw invalidControl(`切换控制字段 ${field} 必须是安全整数。`);
  }
  return result;
}

function hash(value, field) {
  const result = String(value || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(result)) {
    throw invalidControl(`切换控制字段 ${field} 不是有效哈希。`);
  }
  return result;
}

function invalidControl(message) {
  return new HttpError(409, "SWITCH_CONTROL_INVALID", message);
}

module.exports = {
  CONTROL_VERSION,
  controlHash,
  persistedState,
  signSwitchAck,
  signSwitchControl,
  stateHash,
  SWITCH_PHASES,
  verifySwitchAck,
  verifySwitchControl
};
