const { HttpError } = require("../../lib/http-error");
const { CLUSTER_PROTOCOL_VERSION } = require("../hub-cluster/cluster-service");

const MAX_OPERATION_BATCH = 200;
const CAPABILITIES = [
  "operation-v1",
  "acknowledgement-v1",
  "sync-complete-v1",
  "switch-preflight-v1"
];

class PeerReplicationService {
  constructor({
    repository,
    clusterService,
    clusterRepository,
    healthRepository = null,
    now = () => Date.now()
  }) {
    this.repository = repository;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.healthRepository = healthRepository;
    this.now = now;
  }

  hello(userId, peerHello) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = requirePeer(this.clusterRepository, context, peerHello?.nodeId);
    if (peerHello?.spaceId !== context.space_id) {
      throw conflict("PEER_SPACE_MISMATCH", "对端不属于同一个数据空间。");
    }
    if (Number(peerHello?.protocolVersion) !== CLUSTER_PROTOCOL_VERSION) {
      throw conflict("PEER_PROTOCOL_INCOMPATIBLE", "对端复制协议版本不兼容。");
    }
    if (Number(peerHello?.schemaVersion) !== Number(context.schema_version)) {
      throw conflict("PEER_SCHEMA_INCOMPATIBLE", "对端数据库版本暂不兼容。");
    }
    if (Number(peerHello?.epoch) !== Number(context.epoch)) {
      throw conflict("PEER_EPOCH_MISMATCH", "对端 Hub 代次与本地不一致。");
    }
    if (peerHello?.activeNodeId !== context.active_node_id) {
      throw conflict("PEER_ACTIVE_NODE_MISMATCH", "双方记录的当前 Hub 不一致。");
    }
    this.clusterRepository.updatePeerNodeVersion(
      context.space_id,
      peer.id,
      Number(peerHello.protocolVersion),
      Number(peerHello.schemaVersion),
      this.now()
    );
    return this.describe(context, peer.id);
  }

  describeForUser(userId) {
    return this.describe(this.clusterService.ensureSpace(userId));
  }

  describe(context, peerNodeId = "") {
    const watermarks = Object.fromEntries(
      this.repository
        .listOperationHeads(context.space_id)
        .map((head) => [head.originNodeId, head.contiguousSequence])
    );
    return {
      protocolVersion: CLUSTER_PROTOCOL_VERSION,
      schemaVersion: Number(context.schema_version),
      spaceId: context.space_id,
      nodeId: context.local_node_id,
      peerNodeId,
      epoch: Number(context.epoch),
      activeNodeId: context.active_node_id,
      state: context.state,
      watermarks,
      recordsRoot: null,
      pendingBlobCount: 0,
      capabilities: [...CAPABILITIES]
    };
  }

  pull(userId, input) {
    const context = this.clusterService.ensureSpace(userId);
    const originNodeId = String(input?.originNodeId || "").trim();
    requirePeer(this.clusterRepository, context, originNodeId, { allowLocal: true });
    const after = nonNegativeInteger(input?.after, "after");
    const limit = positiveLimit(input?.limit);
    const operations = this.repository.listOperations(
      context.space_id,
      originNodeId,
      after,
      limit + 1
    );
    const hasMore = operations.length > limit;
    if (hasMore) operations.pop();
    const head = this.repository.latestOperation(context.space_id, originNodeId);
    return {
      originNodeId,
      after,
      nextAfter: operations.at(-1)?.originSequence ?? after,
      headSequence: head?.originSequence ?? 0,
      hasMore,
      operations
    };
  }

  acknowledge(userId, peerNodeId, acknowledgements) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = requirePeer(this.clusterRepository, context, peerNodeId);
    if (!Array.isArray(acknowledgements) || acknowledgements.length === 0) {
      throw new HttpError(400, "PEER_ACK_INVALID", "确认位置不能为空。");
    }
    return this.repository.transaction(() => ({
      peerNodeId: peer.id,
      acknowledgements: acknowledgements.map((acknowledgement) =>
        this.saveAcknowledgement(context, peer.id, acknowledgement)
      )
    }));
  }

  confirmSync(userId, peerNodeId, input) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = requirePeer(this.clusterRepository, context, peerNodeId);
    const originNodeId = String(input?.originNodeId || "").trim();
    if (![context.local_node_id, peer.id].includes(originNodeId)) {
      throw new HttpError(
        400,
        "PEER_SYNC_ORIGIN_INVALID",
        "同步完成证明只能指向本机或当前认证对端产生的 Operation。"
      );
    }
    const originSequence = nonNegativeInteger(input?.originSequence, "originSequence");
    const operationHash = String(input?.operationHash || "");
    const head = this.repository.latestOperation(context.space_id, originNodeId);
    const expectedSequence = head?.originSequence ?? 0;
    const expectedHash = head?.operationHash ?? "";
    if (originSequence !== expectedSequence || operationHash !== expectedHash) {
      throw conflict(
        "PEER_SYNC_PROOF_MISMATCH",
        "同步完成证明与电脑 Hub 当前保存的 Operation 链头不一致。"
      );
    }
    if (!this.healthRepository) {
      throw new Error("Replication health repository is required to confirm sync completion.");
    }
    const confirmedAt = this.now();
    const previous = this.healthRepository.find(context.space_id, peer.id);
    const health = this.healthRepository.save({
      spaceId: context.space_id,
      peerNodeId: peer.id,
      state: "healthy",
      lastAttemptAt: previous?.lastAttemptAt ?? confirmedAt,
      lastSuccessAt: confirmedAt,
      lastErrorCode: "",
      lastErrorMessage: "",
      consecutiveFailures: 0,
      nextAttemptAt: null,
      localSequence: originSequence,
      remoteSequence: originSequence,
      updatedAt: confirmedAt
    });
    return {
      ...health,
      originNodeId,
      operationHash: expectedHash,
      caughtUp: true
    };
  }

  saveAcknowledgement(context, peerNodeId, acknowledgement) {
    const originNodeId = String(acknowledgement?.originNodeId || "").trim();
    requirePeer(this.clusterRepository, context, originNodeId, { allowLocal: true });
    const contiguousSequence = nonNegativeInteger(
      acknowledgement?.contiguousSequence,
      "contiguousSequence"
    );
    if (contiguousSequence === 0) {
      throw new HttpError(400, "PEER_ACK_INVALID", "确认位置必须指向已有 Operation。");
    }
    const operation = this.repository.findOperation(
      context.space_id,
      originNodeId,
      contiguousSequence
    );
    if (!operation || operation.operationHash !== acknowledgement?.operationHash) {
      throw conflict("PEER_ACK_HASH_MISMATCH", "确认位置与 Operation 哈希不匹配。");
    }
    const current = this.repository.findAcknowledgement(
      context.space_id,
      peerNodeId,
      originNodeId
    );
    if (current && contiguousSequence < current.contiguousSequence) {
      throw conflict("PEER_ACK_REGRESSION", "对端确认位置不能倒退。");
    }
    return this.repository.saveAcknowledgement({
      spaceId: context.space_id,
      peerNodeId,
      originNodeId,
      contiguousSequence,
      operationHash: operation.operationHash,
      acknowledgedAt: this.now()
    });
  }
}

function requirePeer(repository, context, nodeId, options = {}) {
  const normalizedNodeId = String(nodeId || "").trim();
  const peer = normalizedNodeId
    ? repository.findNode(context.space_id, normalizedNodeId)
    : null;
  if (!peer || peer.revoked_at !== null) {
    throw new HttpError(403, "PEER_NOT_TRUSTED", "对端 Hub 未登记或已经撤销。");
  }
  if (!options.allowLocal && peer.id === context.local_node_id) {
    throw new HttpError(400, "PEER_NODE_INVALID", "不能把本地 Hub 当作复制对端。");
  }
  return peer;
}

function nonNegativeInteger(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new HttpError(400, "PEER_CURSOR_INVALID", `${field} 必须是非负整数。`);
  }
  return number;
}

function positiveLimit(value) {
  const limit = Number(value ?? MAX_OPERATION_BATCH);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_OPERATION_BATCH) {
    throw new HttpError(
      400,
      "PEER_LIMIT_INVALID",
      `单批 Operation 数量必须在 1 到 ${MAX_OPERATION_BATCH} 之间。`
    );
  }
  return limit;
}

function conflict(code, message) {
  return new HttpError(409, code, message);
}

module.exports = { CAPABILITIES, MAX_OPERATION_BATCH, PeerReplicationService };
