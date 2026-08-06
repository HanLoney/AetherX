const { HttpError } = require("../../lib/http-error");
const { CLUSTER_PROTOCOL_VERSION } = require("../hub-cluster/cluster-service");
const { verifyForcedTakeover, proofHash } = require("../hub-cluster/forced-takeover-codec");
const { canonicalStringify, sha256Canonical } = require("./operation-codec");

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
    spaceKeyService = null,
    takeoverRepository = null,
    healthRepository = null,
    onClusterChanged = () => {},
    now = () => Date.now()
  }) {
    this.repository = repository;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.spaceKeyService = spaceKeyService;
    this.takeoverRepository = takeoverRepository;
    this.healthRepository = healthRepository;
    this.onClusterChanged = onClusterChanged;
    this.now = now;
  }

  hello(userId, peerHello) {
    let context = this.clusterService.ensureSpace(userId);
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
    if (Number(peerHello?.epoch) > Number(context.epoch)) {
      context = this.acceptForcedTakeover(context, peer, peerHello);
      this.publishClusterChanged(userId, "forced_takeover");
    } else if (Number(peerHello?.epoch) !== Number(context.epoch)) {
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
    const result = {
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
    const takeover = this.takeoverRepository?.status(context.space_id) || null;
    if (takeover) result.forcedTakeover = takeover;
    return result;
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
    let context = this.clusterService.ensureSpace(userId);
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
    if (context.state === "forced_active" && context.active_node_id === peer.id) {
      context = this.settleForcedTakeover(context);
      this.publishClusterChanged(userId, "forced_takeover_reconciled");
    }
    return {
      ...health,
      originNodeId,
      operationHash: expectedHash,
      caughtUp: true,
      clusterState: context.state
    };
  }

  acceptForcedTakeover(context, peer, peerHello) {
    if (!this.spaceKeyService || !this.takeoverRepository) {
      throw conflict("PEER_EPOCH_MISMATCH", "本机尚未启用强制接管协议。");
    }
    const syncKey = this.spaceKeyService.ensure(context.space_id).key;
    const proof = verifyForcedTakeover(peerHello?.forcedTakeover, syncKey, this.now());
    if (
      proof.spaceId !== context.space_id ||
      proof.previousEpoch !== Number(context.epoch) ||
      proof.epoch !== Number(peerHello.epoch) ||
      proof.previousActiveNodeId !== context.active_node_id ||
      proof.activeNodeId !== peer.id ||
      peerHello.activeNodeId !== peer.id ||
      context.active_node_id !== context.local_node_id
    ) {
      throw conflict("FORCED_TAKEOVER_CONTEXT_MISMATCH", "强制接管证明与本机集群状态不匹配。");
    }
    const knownLocalHead = proof.operationHeads[context.local_node_id] || {
      sequence: 0,
      operationHash: ""
    };
    const localHead = this.repository.latestOperation(
      context.space_id,
      context.local_node_id
    );
    if (knownLocalHead.sequence > Number(localHead?.originSequence || 0)) {
      throw conflict("FORCED_TAKEOVER_HEAD_INVALID", "强制接管证明包含本机不存在的 Operation 链头。");
    }
    if (knownLocalHead.sequence > 0) {
      const knownOperation = this.repository.findOperation(
        context.space_id,
        context.local_node_id,
        knownLocalHead.sequence
      );
      if (!knownOperation || knownOperation.operationHash !== knownLocalHead.operationHash) {
        throw conflict("FORCED_TAKEOVER_HEAD_INVALID", "强制接管证明中的 Operation 链头与本机不匹配。");
      }
    }
    const acceptedAt = this.now();
    return this.clusterRepository.transaction(() => {
      this.takeoverRepository.save({
        id: proof.takeoverId,
        spaceId: context.space_id,
        previousActiveNodeId: proof.previousActiveNodeId,
        activeNodeId: proof.activeNodeId,
        previousEpoch: proof.previousEpoch,
        epoch: proof.epoch,
        proofJson: canonicalStringify(proof),
        proofHash: proofHash(proof),
        controlSignature: String(peerHello.forcedTakeover.authenticationTag || ""),
        integrityJson: canonicalStringify(proof.integrity),
        status: "accepted",
        detectedAt: acceptedAt
      });
      const divergentOperationCount = this.takeoverRepository.quarantineLocalOperations({
        takeoverId: proof.takeoverId,
        spaceId: context.space_id,
        originNodeId: context.local_node_id,
        afterSequence: knownLocalHead.sequence,
        maximumEpoch: Number(context.epoch),
        quarantinedAt: acceptedAt
      });
      const state = divergentOperationCount > 0 ? "divergent" : "forced_active";
      const nextState = {
        spaceId: context.space_id,
        epoch: proof.epoch,
        activeNodeId: peer.id,
        transitionId: proof.takeoverId,
        transitionTargetNodeId: "",
        transitionStartedAt: acceptedAt,
        state
      };
      const updated = this.clusterRepository.updateClusterState({
        ...nextState,
        stateHash: sha256Canonical(nextState),
        controlSignature: String(peerHello.forcedTakeover.authenticationTag || ""),
        updatedAt: acceptedAt
      });
      this.clusterRepository.updateNodeStatus(
        context.space_id,
        context.local_node_id,
        divergentOperationCount > 0 ? "quarantined" : "standby",
        acceptedAt
      );
      this.clusterRepository.updateNodeStatus(context.space_id, peer.id, "active", acceptedAt);
      return updated;
    });
  }

  settleForcedTakeover(context) {
    const settledAt = this.now();
    return this.clusterRepository.transaction(() => {
      const nextState = {
        spaceId: context.space_id,
        epoch: Number(context.epoch),
        activeNodeId: context.active_node_id,
        transitionId: "",
        transitionTargetNodeId: "",
        transitionStartedAt: null,
        state: "stable"
      };
      const updated = this.clusterRepository.updateClusterState({
        ...nextState,
        stateHash: sha256Canonical(nextState),
        controlSignature: context.control_signature,
        updatedAt: settledAt
      });
      this.takeoverRepository.markReconciled(
        context.space_id,
        context.transition_id,
        settledAt
      );
      return updated;
    });
  }

  publishClusterChanged(userId, action) {
    try {
      const cluster = this.clusterService.status(userId);
      this.onClusterChanged(userId, {
        action,
        state: cluster.state,
        activeNodeId: cluster.activeNodeId,
        epoch: cluster.epoch,
        cluster
      });
    } catch (error) {
      console.warn("Unable to publish forced Hub takeover.", error?.message || error);
    }
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
