const { presentChange } = require("./sync-service");

class SyncEventBroker {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.pollIntervalMs = Math.max(100, Number(options.pollIntervalMs) || 750);
    this.heartbeatIntervalMs = Math.max(
      5000,
      Number(options.heartbeatIntervalMs) || 15000
    );
    this.subscribers = new Set();
    this.pendingEvents = new Map();
    this.timer = null;
  }

  subscribe({
    request,
    response,
    userId,
    after = 0,
    clientId = "",
    controlOnly = false,
    onConnectionChange
  }) {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    const initialCursor = controlOnly
      ? this.repository.latestSequence(userId)
      : after;
    const subscriber = {
      response,
      userId,
      clientId,
      controlOnly,
      onConnectionChange,
      cursor: initialCursor,
      lastWriteAt: Date.now()
    };
    this.subscribers.add(subscriber);
    subscriber.onConnectionChange?.(true, subscriber.cursor);
    this.write(subscriber, "ready", {
      cursor: initialCursor,
      latestSequence: this.repository.latestSequence(userId)
    });
    this.flushPending(subscriber);
    this.ensurePolling();

    const cleanup = () => this.remove(subscriber);
    request.once("close", cleanup);
    response.once("close", cleanup);
  }

  ensurePolling() {
    if (this.timer || this.subscribers.size === 0) return;
    this.timer = setInterval(() => this.poll(), this.pollIntervalMs);
    this.timer.unref?.();
  }

  poll() {
    const now = Date.now();
    for (const subscriber of [...this.subscribers]) {
      if (subscriber.response.destroyed || subscriber.response.writableEnded) {
        this.remove(subscriber);
        continue;
      }
      try {
        if (subscriber.controlOnly) {
          subscriber.cursor = this.repository.latestSequence(subscriber.userId);
        } else {
          const rows = this.repository.listChanges(
            subscriber.userId,
            subscriber.cursor,
            100
          );
          for (const row of rows) {
            const change = presentChange(row);
            this.write(subscriber, "change", change, change.seq);
            subscriber.cursor = change.seq;
          }
        }
        if (now - subscriber.lastWriteAt >= this.heartbeatIntervalMs) {
          subscriber.response.write(": heartbeat\n\n");
          subscriber.lastWriteAt = now;
        }
      } catch {
        subscriber.response.end();
        this.remove(subscriber);
      }
    }
  }

  write(subscriber, event, data, id) {
    if (id !== undefined) subscriber.response.write(`id: ${id}\n`);
    subscriber.response.write(`event: ${event}\n`);
    subscriber.response.write(`data: ${JSON.stringify(data)}\n\n`);
    subscriber.lastWriteAt = Date.now();
  }

  publish(userId, event, data, options = {}) {
    const targetClientId = String(options.clientId || "");
    let delivered = 0;
    for (const subscriber of this.subscribers) {
      if (subscriber.userId !== userId) continue;
      if (targetClientId && subscriber.clientId !== targetClientId) continue;
      if (subscriber.response.destroyed || subscriber.response.writableEnded) continue;
      this.write(subscriber, event, data);
      delivered += 1;
    }
    let queued = false;
    if (
      options.alwaysQueue === true ||
      (delivered === 0 && options.queueWhenOffline === true)
    ) {
      const pending = this.pendingEvents.get(userId) || [];
      pending.push({ event, data, clientId: targetClientId, expiresAt: Date.now() + 10 * 60_000 });
      this.pendingEvents.set(userId, pending.slice(-20));
      queued = true;
    }
    return { delivered, queued };
  }

  consumePending(userId, clientId = "", event = "hub-command") {
    const pending = this.pendingEvents.get(userId) || [];
    if (!pending.length) return [];
    const now = Date.now();
    const consumed = [];
    const remaining = [];
    for (const item of pending) {
      if (item.expiresAt <= now) continue;
      const matchesClient = !item.clientId || item.clientId === clientId;
      if (item.event === event && matchesClient && consumed.length < 10) {
        consumed.push(item.data);
      } else {
        remaining.push(item);
      }
    }
    if (remaining.length) this.pendingEvents.set(userId, remaining);
    else this.pendingEvents.delete(userId);
    return consumed;
  }

  flushPending(subscriber) {
    const pending = this.pendingEvents.get(subscriber.userId) || [];
    if (!pending.length) return;
    const now = Date.now();
    const remaining = [];
    for (const item of pending) {
      if (item.expiresAt <= now) continue;
      if (!item.clientId || item.clientId === subscriber.clientId) {
        this.write(subscriber, item.event, item.data);
      } else {
        remaining.push(item);
      }
    }
    if (remaining.length) this.pendingEvents.set(subscriber.userId, remaining);
    else this.pendingEvents.delete(subscriber.userId);
  }

  remove(subscriber) {
    if (!this.subscribers.has(subscriber)) return;
    this.subscribers.delete(subscriber);
    subscriber.onConnectionChange?.(false, subscriber.cursor);
    if (this.subscribers.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const subscriber of this.subscribers) {
      if (!subscriber.response.writableEnded) subscriber.response.end();
      subscriber.onConnectionChange?.(false, subscriber.cursor);
    }
    this.subscribers.clear();
    this.pendingEvents.clear();
  }
}

module.exports = { SyncEventBroker };
