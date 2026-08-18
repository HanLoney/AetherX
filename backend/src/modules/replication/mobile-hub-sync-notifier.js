const { randomUUID } = require("node:crypto");

const DEFAULT_DEBOUNCE_MS = 350;
const DEFAULT_PENDING_TTL_MS = 24 * 60 * 60 * 1000;

class MobileHubSyncNotifier {
  constructor({
    clusterService,
    syncEventBroker,
    localEndpointProvider = () => [],
    debounceMs = DEFAULT_DEBOUNCE_MS,
    pendingTtlMs = DEFAULT_PENDING_TTL_MS,
    now = () => Date.now(),
    createId = randomUUID,
    setTimeout = global.setTimeout.bind(global),
    clearTimeout = global.clearTimeout.bind(global)
  }) {
    this.clusterService = clusterService;
    this.syncEventBroker = syncEventBroker;
    this.localEndpointProvider = localEndpointProvider;
    this.debounceMs = normalizeDelay(debounceMs, DEFAULT_DEBOUNCE_MS);
    this.pendingTtlMs = normalizeDelay(pendingTtlMs, DEFAULT_PENDING_TTL_MS);
    this.now = now;
    this.createId = createId;
    this.setTimeout = setTimeout;
    this.clearTimeout = clearTimeout;
    this.pending = new Map();
  }

  notify(userId, change = {}) {
    const key = String(userId || "");
    if (!key) return;
    const current = this.pending.get(key);
    if (current) {
      current.operationCount += normalizeCount(change.operationCount);
      current.headSequence = Math.max(current.headSequence, normalizeSequence(change.headSequence));
      current.committedAt = Math.max(current.committedAt, normalizeSequence(change.committedAt));
      current.epoch = Math.max(current.epoch, normalizeSequence(change.epoch));
      return;
    }
    const entry = {
      operationCount: normalizeCount(change.operationCount),
      headSequence: normalizeSequence(change.headSequence),
      committedAt: normalizeSequence(change.committedAt),
      epoch: normalizeSequence(change.epoch),
      timer: null
    };
    entry.timer = this.setTimeout(() => {
      try {
        this.flush(key);
      } catch {
        // A periodic Android sync remains available if this best-effort notification fails.
      }
    }, this.debounceMs);
    entry.timer?.unref?.();
    this.pending.set(key, entry);
  }

  flush(userId) {
    const key = String(userId || "");
    const entry = this.pending.get(key);
    if (!entry) return { notified: 0 };
    this.pending.delete(key);
    const hubs = this.clusterService.mobileHubs(key).filter((hub) =>
      !hub.active &&
      hub.ready &&
      hub.status === "standby" &&
      hub.client?.id
    );
    const endpoints = this.localEndpointProvider(key);
    for (const hub of hubs) {
      const command = {
        commandId: this.createId(),
        type: "synchronize-local-hub",
        reason: "operations-committed",
        nodeId: hub.id,
        operationCount: entry.operationCount,
        headSequence: entry.headSequence,
        epoch: entry.epoch,
        committedAt: entry.committedAt,
        ...(endpoints.length ? { endpoints } : {}),
        requestedAt: this.now()
      };
      this.syncEventBroker.publish(key, "hub-command", command, {
        queueWhenOffline: true,
        alwaysQueue: true,
        clientId: hub.client.id,
        coalesceKey: `auto-sync:${hub.id}`,
        ttlMs: this.pendingTtlMs
      });
    }
    return { notified: hubs.length };
  }

  close() {
    for (const entry of this.pending.values()) this.clearTimeout(entry.timer);
    this.pending.clear();
  }
}

function normalizeDelay(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 1 ? number : fallback;
}

function normalizeCount(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 1;
}

function normalizeSequence(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

module.exports = {
  DEFAULT_DEBOUNCE_MS,
  DEFAULT_PENDING_TTL_MS,
  MobileHubSyncNotifier
};
