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
    this.timer = null;
  }

  subscribe({ request, response, userId, after = 0, clientId = "", onConnectionChange }) {
    response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    response.setHeader("Cache-Control", "no-cache, no-transform");
    response.setHeader("Connection", "keep-alive");
    response.flushHeaders?.();

    const subscriber = {
      response,
      userId,
      clientId,
      onConnectionChange,
      cursor: after,
      lastWriteAt: Date.now()
    };
    this.subscribers.add(subscriber);
    subscriber.onConnectionChange?.(true, subscriber.cursor);
    this.write(subscriber, "ready", {
      cursor: after,
      latestSequence: this.repository.latestSequence(userId)
    });
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
  }
}

module.exports = { SyncEventBroker };
