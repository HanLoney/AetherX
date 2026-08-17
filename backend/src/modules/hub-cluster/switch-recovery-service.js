const ABORTABLE_STATES = new Set([
  "preparing_switch",
  "draining",
  "final_sync",
  "integrity_check"
]);
const DEFAULT_RECOVERY_GRACE_MS = 30_000;

class SwitchRecoveryService {
  constructor({
    clusterService,
    clusterRepository,
    switchStateMachineService,
    pollIntervalMs = 5000,
    maxBackoffMs = 300000,
    recoveryGraceMs = DEFAULT_RECOVERY_GRACE_MS,
    now = () => Date.now()
  }) {
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.switchStateMachineService = switchStateMachineService;
    this.pollIntervalMs = normalizeInterval(pollIntervalMs, 5000);
    this.maxBackoffMs = Math.max(
      this.pollIntervalMs,
      normalizeInterval(maxBackoffMs, 300000)
    );
    this.now = now;
    this.recoveryGraceMs = Math.max(0, Number(recoveryGraceMs) || 0);
    this.running = false;
    this.timer = null;
    this.inFlight = null;
    this.recoveringUsers = new Set();
    this.attempts = new Map();
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
      if (this.switchStateMachineService.isBusy?.(userId)) continue;
      const context = this.clusterService.ensureSpace(userId);
      if (!shouldRecoverLocally(context)) continue;
      if (!isRecoveryStale(context, this.now(), this.recoveryGraceMs)) continue;
      const attempt = this.attempts.get(userId);
      if (attempt?.nextAttemptAt > this.now()) continue;
      try {
        await this.runNow(userId);
      } catch {}
    }
  }

  async runNow(userId) {
    if (this.switchStateMachineService.isBusy?.(userId)) {
      const error = new Error("当前 Hub 切换仍在正常执行，暂不启动恢复。");
      error.status = 409;
      error.code = "SWITCH_RECOVERY_BUSY";
      throw error;
    }
    if (this.recoveringUsers.has(userId)) {
      const error = new Error("当前账号正在恢复未完成的 Hub 切换。");
      error.status = 409;
      error.code = "SWITCH_RECOVERY_BUSY";
      throw error;
    }
    this.recoveringUsers.add(userId);
    try {
      return await this.runUnlocked(userId);
    } finally {
      this.recoveringUsers.delete(userId);
    }
  }

  async runUnlocked(userId) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.state === "stable") {
      const result = this.saveSuccess(userId, context, "none", null);
      return { recovered: false, alreadyStable: true, ...result };
    }
    if (!shouldRecoverLocally(context)) {
      const result = this.saveSuccess(userId, context, "waiting_for_active", null);
      return { recovered: false, waitingForActive: true, ...result };
    }
    const transitionId = context.transition_id;
    const action = context.state === "committing_switch" ? "commit" : "abort";
    try {
      const recovery = action === "commit"
        ? await this.switchStateMachineService.commit(userId, { transitionId })
        : await this.switchStateMachineService.abort(userId, { transitionId });
      const current = this.clusterService.ensureSpace(userId);
      const result = this.saveSuccess(userId, current, action, recovery);
      return { recovered: true, ...result };
    } catch (error) {
      this.saveFailure(userId, context, action, error);
      throw error;
    }
  }

  status(userId) {
    const context = this.clusterService.ensureSpace(userId);
    const attempt = this.attempts.get(userId) || null;
    return {
      enabled: this.running,
      required: context.state !== "stable",
      locallyResponsible: shouldRecoverLocally(context),
      recovering: this.recoveringUsers.has(userId),
      state: context.state,
      transitionId: context.transition_id,
      action: context.state === "committing_switch"
        ? "commit"
        : ABORTABLE_STATES.has(context.state)
          ? "abort"
          : "wait",
      ...(attempt || {})
    };
  }

  saveSuccess(userId, context, action, recovery) {
    const value = {
      action,
      state: context.state,
      transitionId: context.transition_id,
      lastAttemptAt: this.now(),
      lastSuccessAt: this.now(),
      consecutiveFailures: 0,
      nextAttemptAt: null,
      lastErrorCode: "",
      lastErrorMessage: ""
    };
    this.attempts.set(userId, value);
    return { ...value, recovery };
  }

  saveFailure(userId, context, action, error) {
    const previous = this.attempts.get(userId);
    const consecutiveFailures = (previous?.consecutiveFailures || 0) + 1;
    const delay = Math.min(
      this.maxBackoffMs,
      this.pollIntervalMs * 2 ** Math.max(0, consecutiveFailures - 1)
    );
    const attemptedAt = this.now();
    this.attempts.set(userId, {
      action,
      state: context.state,
      transitionId: context.transition_id,
      lastAttemptAt: attemptedAt,
      lastSuccessAt: previous?.lastSuccessAt ?? null,
      consecutiveFailures,
      nextAttemptAt: attemptedAt + delay,
      lastErrorCode: String(error.code || "SWITCH_RECOVERY_FAILED").slice(0, 120),
      lastErrorMessage: String(error.message || "未完成切换恢复失败。").slice(0, 300)
    });
  }
}

function shouldRecoverLocally(context) {
  return context.state !== "stable" &&
    context.local_node_id === context.active_node_id &&
    (context.state === "committing_switch" || ABORTABLE_STATES.has(context.state));
}

function isRecoveryStale(context, now, graceMs = DEFAULT_RECOVERY_GRACE_MS) {
  const updatedAt = Number(context.state_updated_at || 0);
  return updatedAt <= 0 || Number(now) - updatedAt >= Math.max(0, Number(graceMs) || 0);
}

function normalizeInterval(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 250 ? number : fallback;
}

module.exports = {
  ABORTABLE_STATES,
  DEFAULT_RECOVERY_GRACE_MS,
  isRecoveryStale,
  SwitchRecoveryService,
  shouldRecoverLocally
};
