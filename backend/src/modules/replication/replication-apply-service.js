const { HttpError } = require("../../lib/http-error");
const { validateOperation } = require("./operation-codec");
const { MAX_OPERATION_BATCH } = require("./peer-replication-service");

class ReplicationApplyService {
  constructor({
    repository,
    clusterService,
    clusterRepository,
    spaceKeyService,
    entityApplier,
    now = () => Date.now()
  }) {
    this.repository = repository;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.spaceKeyService = spaceKeyService;
    this.entityApplier = entityApplier;
    this.now = now;
  }

  apply(userId, peerNodeId, inputOperations) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = this.clusterRepository.findNode(context.space_id, peerNodeId);
    if (!peer || peer.revoked_at !== null || peer.id === context.local_node_id) {
      throw new HttpError(403, "PEER_NOT_TRUSTED", "对端 Hub 未登记或已经撤销。");
    }
    if (context.state === "divergent") {
      throw conflict(
        "REPLICATION_DIVERGENCE_REQUIRES_RECOVERY",
        "旧 Hub 存在未确认写入，已停止自动覆盖并等待恢复处理。"
      );
    }
    if (
      !Array.isArray(inputOperations) ||
      inputOperations.length < 1 ||
      inputOperations.length > MAX_OPERATION_BATCH
    ) {
      throw new HttpError(
        400,
        "REPLICATION_BATCH_INVALID",
        `单批 Operation 数量必须在 1 到 ${MAX_OPERATION_BATCH} 之间。`
      );
    }
    const syncKey = this.spaceKeyService.ensure(context.space_id).key;
    return this.repository.transaction(() => {
      const result = { applied: 0, skipped: 0, acknowledgements: {} };
      for (const input of inputOperations) {
        const operation = validateOperation(input, { syncKey });
        if (operation.spaceId !== context.space_id) {
          throw conflict("REPLICATION_SPACE_MISMATCH", "Operation 不属于当前数据空间。");
        }
        if (operation.originNodeId !== peer.id) {
          throw conflict("REPLICATION_ORIGIN_MISMATCH", "Operation 来源与认证节点不一致。");
        }
        if (operation.originNodeId !== context.active_node_id) {
          throw conflict("REPLICATION_ORIGIN_NOT_ACTIVE", "Operation 不是由当前活动 Hub 产生的。");
        }
        if (operation.epoch !== Number(context.epoch)) {
          throw conflict("REPLICATION_EPOCH_MISMATCH", "Operation 的 Hub 代次不匹配。");
        }
        if (this.skipAppliedOperation(context, operation, result)) continue;
        this.assertContinuity(context, operation);
        this.assertEntityVersion(context, operation);
        this.entityApplier.apply(userId, operation);
        this.repository.insertOperation(operation);
        this.repository.setEntityVersion(
          context.space_id,
          operation.entityType,
          operation.entityId,
          operation.entityVersion,
          this.now()
        );
        this.repository.markApplied(operation.operationId, context.space_id, this.now());
        result.applied += 1;
        result.acknowledgements[operation.originNodeId] = {
          originNodeId: operation.originNodeId,
          contiguousSequence: operation.originSequence,
          operationHash: operation.operationHash
        };
      }
      return result;
    });
  }

  skipAppliedOperation(context, operation, result) {
    const existing = this.repository.findOperationById(operation.operationId);
    if (!existing) return false;
    if (existing.operationHash !== operation.operationHash) {
      throw conflict("REPLICATION_OPERATION_COLLISION", "Operation ID 对应了不同内容。");
    }
    if (!this.repository.isApplied(operation.operationId)) {
      throw conflict("REPLICATION_APPLY_STATE_INVALID", "Operation 已存在但缺少应用记录。");
    }
    result.skipped += 1;
    const latest = this.repository.latestOperation(
      context.space_id,
      operation.originNodeId
    );
    result.acknowledgements[operation.originNodeId] = {
      originNodeId: operation.originNodeId,
      contiguousSequence: latest.originSequence,
      operationHash: latest.operationHash
    };
    return true;
  }

  assertContinuity(context, operation) {
    const latest = this.repository.latestOperation(
      context.space_id,
      operation.originNodeId
    );
    const expectedSequence = (latest?.originSequence || 0) + 1;
    const expectedHash = latest?.operationHash || "";
    if (operation.originSequence !== expectedSequence) {
      throw conflict("REPLICATION_SEQUENCE_GAP", "Operation 序列存在缺口或发生倒退。", {
        expectedSequence,
        receivedSequence: operation.originSequence
      });
    }
    if (operation.previousOperationHash !== expectedHash) {
      throw conflict("REPLICATION_HASH_CHAIN_BROKEN", "Operation 前序哈希不连续。");
    }
  }

  assertEntityVersion(context, operation) {
    const current = this.repository.findEntityVersion(
      context.space_id,
      operation.entityType,
      operation.entityId
    );
    const expectedPrevious = current?.version ?? null;
    const expectedVersion = (expectedPrevious || 0) + 1;
    if (
      operation.previousEntityVersion !== expectedPrevious ||
      operation.entityVersion !== expectedVersion
    ) {
      throw conflict("REPLICATION_ENTITY_VERSION_CONFLICT", "实体版本与本地状态不连续。", {
        expectedPreviousEntityVersion: expectedPrevious,
        receivedPreviousEntityVersion: operation.previousEntityVersion,
        expectedEntityVersion: expectedVersion,
        receivedEntityVersion: operation.entityVersion
      });
    }
  }
}

function conflict(code, message, details) {
  return new HttpError(409, code, message, details);
}

module.exports = { ReplicationApplyService };
