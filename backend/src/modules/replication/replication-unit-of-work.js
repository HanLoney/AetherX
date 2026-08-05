const { randomUUID } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");
const {
  OPERATION_PROTOCOL_VERSION,
  buildOperation,
  sha256Canonical
} = require("./operation-codec");

const IDEMPOTENCY_TTL_MS = 30 * 24 * 60 * 60 * 1000;

class ReplicationUnitOfWork {
  constructor({ repository, clusterService, spaceKeyService = null, now = () => Date.now() }) {
    this.repository = repository;
    this.clusterService = clusterService;
    this.spaceKeyService = spaceKeyService;
    this.now = now;
  }

  findRepeated(userId, requestId) {
    const normalizedRequestId = requireRequestId(requestId);
    const context = this.clusterService.ensureSpace(userId);
    assertLocalActive(context);
    const repeated = this.repository.findIdempotency(
      context.space_id,
      normalizedRequestId
    );
    return repeated ? { ...repeated, repeated: true, operations: [] } : null;
  }

  execute(userId, requestId, mutation) {
    const normalizedRequestId = requireRequestId(requestId);
    if (typeof mutation !== "function") throw new TypeError("mutation 必须是函数。");
    const context = this.clusterService.ensureSpace(userId);
    assertLocalActive(context);
    const spaceKey = this.spaceKeyService?.ensure(context.space_id) || null;
    const syncKey = spaceKey?.key;
    return this.repository.transaction(() => {
      const repeated = this.repository.findIdempotency(
        context.space_id,
        normalizedRequestId
      );
      if (repeated) return { ...repeated, repeated: true, operations: [] };

      const mutationResult = mutation({
        spaceId: context.space_id,
        nodeId: context.local_node_id,
        epoch: Number(context.epoch),
        syncKey,
        keyVersion: spaceKey?.keyVersion ?? null
      });
      if (mutationResult && typeof mutationResult.then === "function") {
        throw new TypeError("复制事务中的 mutation 必须同步完成。");
      }
      const normalized = normalizeMutationResult(mutationResult);
      const createdAt = this.now();
      const latest = this.repository.latestOperation(
        context.space_id,
        context.local_node_id
      );
      let sequence = latest?.originSequence || 0;
      let previousOperationHash = latest?.operationHash || "";
      const operations = normalized.changes.map((change) => {
        sequence += 1;
        const entityVersion = this.repository.advanceEntityVersion(
          context.space_id,
          change.entityType,
          change.entityId,
          createdAt
        );
        const operation = buildOperation({
          protocolVersion: OPERATION_PROTOCOL_VERSION,
          operationId: randomUUID(),
          spaceId: context.space_id,
          originNodeId: context.local_node_id,
          originSequence: sequence,
          epoch: Number(context.epoch),
          entityType: change.entityType,
          entityId: change.entityId,
          operation: change.operation,
          entityVersion: entityVersion.entityVersion,
          previousEntityVersion: entityVersion.previousEntityVersion,
          payload: change.payload,
          previousOperationHash,
          createdAt
        }, { syncKey });
        this.repository.insertOperation(operation);
        previousOperationHash = operation.operationHash;
        return operation;
      });
      const resultHash = sha256Canonical(normalized.result);
      this.repository.saveIdempotency({
        spaceId: context.space_id,
        requestId: normalizedRequestId,
        status: normalized.status,
        resultHash,
        result: normalized.result,
        createdAt,
        expiresAt: createdAt + IDEMPOTENCY_TTL_MS
      });
      return {
        status: normalized.status,
        resultHash,
        result: normalized.result,
        createdAt,
        expiresAt: createdAt + IDEMPOTENCY_TTL_MS,
        repeated: false,
        operations
      };
    });
  }
}

function normalizeMutationResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("复制事务必须返回 { result, changes }。");
  }
  const status = Number(value.status ?? 200);
  if (!Number.isSafeInteger(status) || status < 200 || status > 299) {
    throw new TypeError("复制事务返回了无效状态码。");
  }
  const result = value.result === undefined ? null : value.result;
  const changes = Array.isArray(value.changes) ? value.changes : [];
  return {
    status,
    result,
    changes: changes.map(normalizeChange)
  };
}

function normalizeChange(change) {
  if (!change || typeof change !== "object" || Array.isArray(change)) {
    throw new TypeError("复制变更必须是对象。");
  }
  return {
    entityType: change.entityType,
    entityId: change.entityId,
    operation: change.operation,
    payload: change.payload
  };
}

function assertLocalActive(context) {
  if (context.local_node_id === context.active_node_id && context.state === "stable") return;
  throw new HttpError(
    409,
    "HUB_NOT_ACTIVE",
    "这台 Hub 当前不是数据空间的活动节点。",
    {
      activeNodeId: context.active_node_id,
      localNodeId: context.local_node_id,
      epoch: Number(context.epoch),
      state: context.state
    }
  );
}

function requireRequestId(value) {
  const requestId = String(value || "").trim();
  if (!requestId || requestId.length > 200 || /[\u0000-\u001f]/.test(requestId)) {
    throw new HttpError(400, "REQUEST_ID_INVALID", "写入请求缺少有效的幂等请求 ID。");
  }
  return requestId;
}

module.exports = { IDEMPOTENCY_TTL_MS, ReplicationUnitOfWork };
