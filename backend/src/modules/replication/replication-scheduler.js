const { HttpError } = require("../../lib/http-error");

const DEFAULT_POLL_INTERVAL_MS = 5000;
const DEFAULT_MAX_BACKOFF_MS = 5 * 60 * 1000;

class ReplicationScheduler {
  constructor({
    repository,
    clusterService,
    clusterRepository,
    peerTransport,
    bootstrapCoordinator,
    mediaReplicationService,
    pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
    maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
    now = () => Date.now(),
    random = Math.random
  }) {
    this.repository = repository;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.peerTransport = peerTransport;
    this.bootstrapCoordinator = bootstrapCoordinator;
    this.mediaReplicationService = mediaReplicationService;
    this.pollIntervalMs = normalizeInterval(pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
    this.maxBackoffMs = Math.max(
      this.pollIntervalMs,
      normalizeInterval(maxBackoffMs, DEFAULT_MAX_BACKOFF_MS)
    );
    this.now = now;
    this.random = random;
    this.running = false;
    this.timer = null;
    this.inFlight = null;
    this.syncingUsers = new Set();
    this.activeControllers = new Set();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.schedule(0);
  }

  async stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    for (const controller of this.activeControllers) controller.abort();
    if (this.inFlight) await this.inFlight;
  }

  schedule(delay) {
    if (!this.running) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.inFlight = this.tick()
        .catch(() => {})
        .finally(() => {
          this.inFlight = null;
          this.schedule(this.pollIntervalMs);
        });
    }, delay);
    this.timer.unref?.();
  }

  async tick() {
    for (const userId of this.clusterRepository.listSpaceUserIds()) {
      const context = this.clusterService.ensureSpace(userId);
      if (context.local_node_id === context.active_node_id || context.state !== "stable") continue;
      const localNode = this.clusterRepository.findNode(context.space_id, context.local_node_id);
      if (localNode?.status !== "standby") continue;
      const health = this.repository.find(context.space_id, context.active_node_id);
      if (health?.nextAttemptAt && health.nextAttemptAt > this.now()) continue;
      try {
        await this.runNow(userId);
      } catch {}
    }
  }

  async runNow(userId, options = {}) {
    if (this.syncingUsers.has(userId)) {
      throw new HttpError(409, "REPLICATION_SYNC_BUSY", "当前账号正在执行增量同步。");
    }
    this.syncingUsers.add(userId);
    const controller = new AbortController();
    this.activeControllers.add(controller);
    try {
      return await this.runUnlocked(userId, controller.signal, options);
    } finally {
      this.activeControllers.delete(controller);
      this.syncingUsers.delete(userId);
    }
  }

  async runUnlocked(userId, signal, options = {}) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.local_node_id === context.active_node_id) {
      throw new HttpError(409, "REPLICATION_SOURCE_IS_LOCAL", "活动 Hub 不需要从备用节点拉取数据。");
    }
    if (
      context.state !== "stable" &&
      !(options.allowTransition === true &&
        ["draining", "final_sync"].includes(context.state))
    ) {
      throw new HttpError(409, "REPLICATION_CLUSTER_TRANSITIONING", "Hub 切换期间不会执行普通增量同步。");
    }
    const localNode = this.clusterRepository.findNode(context.space_id, context.local_node_id);
    if (localNode?.status !== "standby") {
      throw new HttpError(409, "REPLICATION_BOOTSTRAP_REQUIRED", "备用 Hub 尚未完成首次全量同步。");
    }
    const peerNodeId = context.active_node_id;
    const previous = this.repository.find(context.space_id, peerNodeId);
    const attemptedAt = this.now();
    this.repository.save({
      spaceId: context.space_id,
      peerNodeId,
      state: "syncing",
      lastAttemptAt: attemptedAt,
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      consecutiveFailures: previous?.consecutiveFailures || 0,
      nextAttemptAt: null,
      localSequence: previous?.localSequence || 0,
      remoteSequence: previous?.remoteSequence || 0,
      updatedAt: attemptedAt
    });
    try {
      await this.peerTransport.requestJson(userId, peerNodeId, {
        method: "POST",
        path: "/api/v1/peer/hello",
        body: {
          protocolVersion: Number(context.protocol_version),
          schemaVersion: Number(context.schema_version),
          spaceId: context.space_id,
          nodeId: context.local_node_id,
          epoch: Number(context.epoch),
          activeNodeId: peerNodeId
        },
        signal
      });
      const progress = await this.bootstrapCoordinator.pullUntilCurrent(
        userId,
        peerNodeId,
        { signal }
      );
      const media = await this.mediaReplicationService.synchronizeFromPeer(
        userId,
        peerNodeId,
        this.peerTransport,
        { signal }
      );
      const succeededAt = this.now();
      const health = this.repository.save({
        spaceId: context.space_id,
        peerNodeId,
        state: "healthy",
        lastAttemptAt: attemptedAt,
        lastSuccessAt: succeededAt,
        consecutiveFailures: 0,
        nextAttemptAt: succeededAt + this.pollIntervalMs,
        localSequence: progress.localSequence,
        remoteSequence: progress.remoteSequence,
        updatedAt: succeededAt
      });
      return { ...health, media };
    } catch (error) {
      const failedAt = this.now();
      const consecutiveFailures = (previous?.consecutiveFailures || 0) + 1;
      const delay = this.backoffDelay(consecutiveFailures);
      this.repository.save({
        spaceId: context.space_id,
        peerNodeId,
        state: "degraded",
        lastAttemptAt: attemptedAt,
        lastSuccessAt: previous?.lastSuccessAt ?? null,
        lastErrorCode: String(error.code || "REPLICATION_SYNC_FAILED").slice(0, 120),
        lastErrorMessage: String(error.message || "增量同步失败。").slice(0, 300),
        consecutiveFailures,
        nextAttemptAt: failedAt + delay,
        localSequence: previous?.localSequence || 0,
        remoteSequence: previous?.remoteSequence || 0,
        updatedAt: failedAt
      });
      throw error;
    }
  }

  status(userId) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.local_node_id === context.active_node_id) {
      return {
        role: "active",
        state: context.state === "stable" ? "serving" : "transitioning",
        peerNodeId: "",
        schedulerRunning: this.running
      };
    }
    const health = this.repository.find(context.space_id, context.active_node_id);
    return {
      role: "standby",
      state: health?.state || "waiting",
      peerNodeId: context.active_node_id,
      schedulerRunning: this.running,
      media: this.mediaReplicationService.status(userId, context.active_node_id),
      ...(health || {})
    };
  }

  backoffDelay(failures) {
    const exponential = Math.min(
      this.maxBackoffMs,
      this.pollIntervalMs * 2 ** Math.max(0, failures - 1)
    );
    const jitter = 0.8 + Math.max(0, Math.min(1, this.random())) * 0.4;
    return Math.max(this.pollIntervalMs, Math.round(exponential * jitter));
  }
}

function normalizeInterval(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 250 ? number : fallback;
}

module.exports = {
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_POLL_INTERVAL_MS,
  ReplicationScheduler
};
