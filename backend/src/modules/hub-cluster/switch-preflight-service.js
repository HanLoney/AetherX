const { HttpError } = require("../../lib/http-error");
const { canonicalStringify } = require("../replication/operation-codec");

class SwitchPreflightService {
  constructor({
    clusterService,
    clusterRepository,
    integrityService,
    peerTransport
  }) {
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.integrityService = integrityService;
    this.peerTransport = peerTransport;
  }

  async inspect(userId, input = {}) {
    return this.inspectWithState(userId, input, "stable", "");
  }

  async inspectTransition(userId, targetNodeId, transitionId) {
    return this.inspectWithState(
      userId,
      { targetNodeId },
      "integrity_check",
      transitionId
    );
  }

  async inspectPeerProof(userId, targetNodeId, signedProof, expectedState) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.local_node_id !== context.active_node_id) {
      throw new HttpError(
        409,
        "SWITCH_SOURCE_NOT_ACTIVE",
        "请连接当前活动 Hub 发起计划切换预检。",
        { activeNodeId: context.active_node_id }
      );
    }
    if (context.state !== expectedState) {
      throw new HttpError(
        409,
        "SWITCH_CLUSTER_NOT_STABLE",
        "集群状态与手机端切换阶段不一致。"
      );
    }
    const target = selectTarget(
      this.clusterRepository.listNodes(context.space_id),
      context.local_node_id,
      targetNodeId
    );
    const localSigned = await this.integrityService.createSwitchPreflightProof(userId);
    const local = localSigned.proof;
    const remote = this.integrityService.verifySwitchPreflightProof(
      userId,
      target.id,
      signedProof
    );
    const checks = buildChecks(context, target, local, remote, expectedState);
    return {
      ready: checks.every((check) => check.passed),
      sourceNodeId: context.local_node_id,
      targetNodeId: target.id,
      epoch: Number(context.epoch),
      checkedAt: Date.now(),
      checks,
      local: summarizeProof(local),
      remote: summarizeProof(remote),
      endpoint: { transport: "reverse-peer", address: "peer-authenticated" }
    };
  }

  async inspectWithState(userId, input, expectedState, transitionId) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.local_node_id !== context.active_node_id) {
      throw new HttpError(
        409,
        "SWITCH_SOURCE_NOT_ACTIVE",
        "请连接当前活动 Hub 发起计划切换预检。",
        { activeNodeId: context.active_node_id }
      );
    }
    if (
      context.state !== expectedState ||
      (transitionId && context.transition_id !== transitionId)
    ) {
      throw new HttpError(
        409,
        "SWITCH_CLUSTER_NOT_STABLE",
        "集群状态与当前切换预检阶段不一致。"
      );
    }
    const target = selectTarget(
      this.clusterRepository.listNodes(context.space_id),
      context.local_node_id,
      input.targetNodeId
    );
    const localSigned = await this.integrityService.createSwitchPreflightProof(userId);
    const local = localSigned.proof;
    const remoteResponse = await this.peerTransport.requestJson(userId, target.id, {
      method: "POST",
      path: "/api/v1/peer/switch/preflight",
      body: {}
    });
    const remote = this.integrityService.verifySwitchPreflightProof(
      userId,
      target.id,
      remoteResponse.data
    );
    const checks = buildChecks(context, target, local, remote, expectedState);
    return {
      ready: checks.every((check) => check.passed),
      sourceNodeId: context.local_node_id,
      targetNodeId: target.id,
      epoch: Number(context.epoch),
      checkedAt: Date.now(),
      checks,
      local: summarizeProof(local),
      remote: summarizeProof(remote),
      endpoint: remoteResponse.endpoint
    };
  }
}

function selectTarget(nodes, localNodeId, requestedNodeId) {
  const candidates = nodes.filter(
    (node) => node.id !== localNodeId && node.revoked_at === null
  );
  const requested = String(requestedNodeId || "").trim();
  const target = requested
    ? candidates.find((node) => node.id === requested)
    : candidates.length === 1
      ? candidates[0]
      : null;
  if (!target) {
    throw new HttpError(
      400,
      "SWITCH_TARGET_REQUIRED",
      "请选择唯一且可信的备用 Hub。"
    );
  }
  if (target.status !== "standby") {
    throw new HttpError(
      409,
      "SWITCH_TARGET_NOT_STANDBY",
      "目标 Hub 尚未完成同步，不能参与计划切换。",
      { targetNodeId: target.id, status: target.status }
    );
  }
  return target;
}

function buildChecks(context, target, local, remote, expectedState) {
  const sameHeads = canonicalStringify(local.operationHeads || {}) ===
    canonicalStringify(remote.operationHeads || {});
  return [
    check("cluster", "双方切换阶段一致", local.clusterState === expectedState && remote.clusterState === expectedState),
    check("target", "目标节点为可用备用 Hub", remote.nodeId === target.id && remote.role === "standby" && remote.nodeStatus === "standby"),
    check("space", "双方属于同一数据空间", remote.spaceId === context.space_id),
    check("epoch", "双方活动节点与代次一致", Number(remote.epoch) === Number(context.epoch) && remote.activeNodeId === context.active_node_id),
    check("protocol", "复制协议版本一致", remote.protocolVersion === local.protocolVersion),
    check("schema", "数据库 Schema 版本一致", remote.schemaVersion === local.schemaVersion),
    check("database", "双方数据库检查通过", local.databaseHealthy === true && remote.databaseHealthy === true),
    check("credentials", "双方可读取 Provider 凭证", local.providerCredentialsReadable === true && remote.providerCredentialsReadable === true),
    check("agent", "双方没有正在运行的 Agent", local.agentIdle === true && remote.agentIdle === true),
    check("operations", "Operation 已完全追平", sameHeads),
    check("records", "结构化数据根摘要一致", remote.recordsRoot === local.recordsRoot),
    check("media", "原图根摘要一致且没有待传文件", remote.blobsRoot === local.blobsRoot && local.pendingMediaCount === 0 && remote.pendingMediaCount === 0),
    check("bootstrap", "没有未完成的 Bootstrap", local.busyBootstrapCount === 0 && remote.busyBootstrapCount === 0)
  ];
}

function check(id, label, passed) {
  return { id, label, passed: passed === true };
}

function summarizeProof(proof) {
  return {
    nodeId: proof.nodeId,
    role: proof.role,
    nodeStatus: proof.nodeStatus,
    recordsRoot: proof.recordsRoot,
    blobsRoot: proof.blobsRoot,
    operationHeads: proof.operationHeads,
    pendingMediaCount: proof.pendingMediaCount,
    busyBootstrapCount: proof.busyBootstrapCount,
    generatedAt: proof.generatedAt
  };
}

module.exports = { SwitchPreflightService };
