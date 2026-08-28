const { HttpError } = require("../../lib/http-error");

class ClientSessionHandoffService {
  constructor({
    clusterService,
    clusterRepository,
    peerTransport,
    authService,
    now = () => Date.now(),
    sleep = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
    handoffWindowMs = 20_000,
    attemptTimeoutMs = 5_000
  }) {
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.peerTransport = peerTransport;
    this.authService = authService;
    this.now = now;
    this.sleep = sleep;
    this.handoffWindowMs = handoffWindowMs;
    this.attemptTimeoutMs = attemptTimeoutMs;
  }

  async handoff(userId) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.state !== "stable") {
      throw new HttpError(
        423,
        "HUB_SWITCH_IN_PROGRESS",
        "Hub 切换尚未稳定，暂时不能交接客户端会话。",
        { state: context.state, transitionId: context.transition_id }
      );
    }
    if (context.local_node_id === context.active_node_id) {
      return {
        handedOff: false,
        alreadyActive: true,
        serverUrl: "",
        cluster: this.clusterService.status(userId)
      };
    }
    const activeNode = this.clusterRepository.findNode(
      context.space_id,
      context.active_node_id
    );
    if (!activeNode || activeNode.revoked_at !== null || activeNode.status !== "active") {
      throw new HttpError(
        503,
        "HUB_REPLICA_NOT_READY",
        "当前活动 Hub 尚未准备好接收客户端连接。"
      );
    }
    const response = await this.requestClientSession(userId, activeNode.id);
    return {
      handedOff: true,
      serverUrl: response.endpoint.address,
      transport: response.endpoint.transport,
      targetNodeId: activeNode.id,
      ...response.data
    };
  }

  async requestClientSession(userId, activeNodeId) {
    const deadline = this.now() + this.handoffWindowMs;
    while (true) {
      try {
        return await this.peerTransport.requestJson(userId, activeNodeId, {
          method: "POST",
          path: "/api/v1/peer/client-sessions/mint",
          body: {},
          timeoutMs: Math.min(
            this.attemptTimeoutMs,
            Math.max(1, deadline - this.now())
          )
        });
      } catch (error) {
        if (error?.code !== "PEER_UNREACHABLE" || this.now() >= deadline) throw error;
        await this.sleep(Math.min(500, Math.max(1, deadline - this.now())));
      }
    }
  }

  mintForPeer(userId, peerNodeId) {
    const context = this.clusterService.ensureSpace(userId);
    if (
      context.state !== "stable" ||
      context.local_node_id !== context.active_node_id
    ) {
      throw new HttpError(
        409,
        "HUB_NOT_ACTIVE",
        "只有稳定状态下的活动 Hub 可以签发客户端交接会话。",
        {
          activeNodeId: context.active_node_id,
          localNodeId: context.local_node_id,
          epoch: Number(context.epoch),
          state: context.state
        }
      );
    }
    const peer = this.clusterRepository.findNode(context.space_id, peerNodeId);
    if (!peer || peer.revoked_at !== null || peer.id === context.local_node_id) {
      throw new HttpError(403, "PEER_NOT_TRUSTED", "请求会话交接的 Hub 不受信任。");
    }
    return {
      ...this.authService.createHandoffSession(userId),
      spaceId: context.space_id,
      nodeId: context.local_node_id,
      activeNodeId: context.active_node_id,
      epoch: Number(context.epoch)
    };
  }
}

module.exports = { ClientSessionHandoffService };
