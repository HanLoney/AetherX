class DesktopSyncCoordinator {
  constructor(options) {
    this.api = options.api;
    this.onChanges = options.onChanges;
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.realtime = options.realtime === true;
    this.pollIntervalMs = Math.max(250, Number(options.pollIntervalMs) || 900);
    this.retryIntervalMs = Math.max(1000, Number(options.retryIntervalMs) || 3000);
    this.cursor = 0;
    this.scope = "";
    this.running = false;
    this.primed = false;
    this.generation = 0;
    this.timer = null;
    this.controller = null;
  }

  async start(scope) {
    const nextScope = String(scope || "");
    if (this.running && this.scope === nextScope) return;
    this.stop();
    this.running = true;
    this.scope = nextScope;
    this.cursor = 0;
    this.primed = false;
    const generation = this.generation;

    // 页面会在这之后读取完整数据，因此启动时只追到最新游标，避免把历史
    // 变更误当成实时更新反复刷新界面。
    try {
      await this.drainChanges(generation, false);
      this.primed = true;
    } catch (error) {
      console.warn("AetherX desktop sync will retry its initial connection.", error?.message || error);
    }
    if (this.isCurrent(generation)) {
      if (this.realtime) void this.connect(generation);
      else this.schedule(generation, this.primed ? 0 : this.retryIntervalMs);
    }
  }

  stop() {
    this.running = false;
    this.scope = "";
    this.cursor = 0;
    this.primed = false;
    this.generation += 1;
    clearTimeout(this.timer);
    this.timer = null;
    this.controller?.abort();
    this.controller = null;
  }

  async pollNow() {
    if (!this.running) return [];
    const changes = await this.drainChanges(this.generation, this.primed);
    this.primed = true;
    return changes;
  }

  async drainChanges(generation, emit) {
    const collected = [];
    let hasMore = true;
    while (hasMore && this.isCurrent(generation)) {
      const previousCursor = this.cursor;
      const page = await this.api.listSyncChanges({
        after: this.cursor,
        limit: 500
      });
      if (!this.isCurrent(generation)) return [];
      const changes = Array.isArray(page?.changes) ? page.changes : [];
      collected.push(...changes);
      this.cursor = Math.max(this.cursor, Number(page?.nextCursor) || this.cursor);
      hasMore = Boolean(page?.hasMore);
      if (hasMore && this.cursor <= previousCursor) {
        throw new Error("同步游标没有继续前进。");
      }
    }
    if (emit && collected.length && this.isCurrent(generation)) {
      await this.onChanges(collected);
    }
    return collected;
  }

  async connect(generation) {
    while (this.isCurrent(generation)) {
      this.controller = new AbortController();
      try {
        const query = new URLSearchParams({
          after: String(this.cursor),
          client_id: `desktop-sync:${this.scope}`
        });
        const response = await this.fetchImpl(
          `${this.api.baseUrl}/api/v1/sync/events?${query}`,
          {
            headers: this.api.token
              ? { Authorization: `Bearer ${this.api.token}` }
              : {},
            signal: this.controller.signal
          }
        );
        if (!response.ok || !response.body) {
          throw new Error(`Desktop sync stream returned HTTP ${response.status}.`);
        }
        await parseEventStream(response.body, async (event) => {
          if (!this.isCurrent(generation) || event.event !== "change") return;
          let change;
          try {
            change = JSON.parse(event.data);
          } catch {
            return;
          }
          const sequence = Number(change?.seq);
          if (!Number.isSafeInteger(sequence) || sequence <= this.cursor) return;
          this.cursor = sequence;
          this.primed = true;
          await this.onChanges([change]);
        });
      } catch (error) {
        if (!this.isCurrent(generation) || error?.name === "AbortError") return;
        console.warn("AetherX desktop realtime sync is retrying.", error?.message || error);
      } finally {
        this.controller = null;
      }
      if (!this.isCurrent(generation)) return;
      try {
        await this.drainChanges(generation, true);
        this.primed = true;
      } catch (error) {
        console.warn("AetherX desktop sync catch-up will retry.", error?.message || error);
      }
      await wait(this.retryIntervalMs);
    }
  }

  schedule(generation, delay = this.pollIntervalMs) {
    clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      if (!this.isCurrent(generation)) return;
      let nextDelay = this.pollIntervalMs;
      try {
        await this.drainChanges(generation, this.primed);
        this.primed = true;
      } catch (error) {
        nextDelay = this.retryIntervalMs;
        console.warn("AetherX desktop sync is retrying.", error?.message || error);
      }
      if (this.isCurrent(generation)) this.schedule(generation, nextDelay);
    }, delay);
    this.timer.unref?.();
  }

  isCurrent(generation) {
    return this.running && this.generation === generation;
  }
}

class DesktopControlCoordinator {
  constructor(options = {}) {
    this.onEvent = options.onEvent || (() => {});
    this.fetchImpl = options.fetchImpl || globalThis.fetch;
    this.retryBaseMs = Math.max(100, Number(options.retryBaseMs) || 1000);
    this.maxRetryMs = Math.max(this.retryBaseMs, Number(options.maxRetryMs) || 30_000);
    this.random = options.random || Math.random;
    this.waitImpl = options.waitImpl || wait;
    this.running = false;
    this.scope = "";
    this.generation = 0;
    this.controller = null;
    this.retryAttempt = 0;
  }

  start(options = {}) {
    const baseUrl = String(options.baseUrl || "").trim().replace(/\/+$/, "");
    const token = String(options.token || "");
    const clientId = String(options.clientId || "");
    const scope = `${baseUrl}|${token}|${clientId}`;
    if (!baseUrl || !token) {
      this.stop();
      return;
    }
    if (this.running && this.scope === scope) return;
    this.stop();
    this.running = true;
    this.scope = scope;
    this.retryAttempt = 0;
    const generation = this.generation;
    void this.connect({ baseUrl, token, clientId }, generation);
  }

  stop() {
    this.running = false;
    this.scope = "";
    this.generation += 1;
    this.controller?.abort();
    this.controller = null;
  }

  async connect(options, generation) {
    while (this.isCurrent(generation)) {
      this.controller = new AbortController();
      try {
        const query = new URLSearchParams({ control_only: "1" });
        if (options.clientId) query.set("client_id", options.clientId);
        const response = await this.fetchImpl(
          `${options.baseUrl}/api/v1/sync/events?${query}`,
          {
            headers: { Authorization: `Bearer ${options.token}` },
            signal: this.controller.signal
          }
        );
        if (!response.ok || !response.body) {
          throw new Error(`Hub control stream returned HTTP ${response.status}.`);
        }
        this.retryAttempt = 0;
        await parseEventStream(response.body, async (event) => {
          if (!this.isCurrent(generation) || !event.data) return;
          let data;
          try {
            data = JSON.parse(event.data);
          } catch {
            return;
          }
          try {
            await this.onEvent({ event: event.event, data, id: event.id });
          } catch (error) {
            console.warn("Unable to handle Hub control event.", error?.message || error);
          }
        });
      } catch (error) {
        if (!this.isCurrent(generation) || error?.name === "AbortError") return;
        console.warn("AetherX desktop control stream is retrying.", error?.message || error);
      } finally {
        if (this.controller?.signal.aborted || !this.isCurrent(generation)) {
          this.controller = null;
        }
      }
      if (!this.isCurrent(generation)) return;
      const delay = Math.min(
        this.maxRetryMs,
        this.retryBaseMs * 2 ** this.retryAttempt
      ) + Math.floor(this.random() * 400);
      this.retryAttempt += 1;
      await this.waitImpl(delay);
    }
  }

  isCurrent(generation) {
    return this.running && this.generation === generation;
  }
}

async function parseEventStream(stream, handler) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const event = parseEventBlock(block);
      if (event.data) await handler(event);
      boundary = buffer.indexOf("\n\n");
    }
    if (done) break;
  }
}

function parseEventBlock(block) {
  const result = { event: "message", data: "", id: "" };
  const data = [];
  for (const line of block.split("\n")) {
    if (!line || line.startsWith(":")) continue;
    const separator = line.indexOf(":");
    const field = separator < 0 ? line : line.slice(0, separator);
    const value = separator < 0 ? "" : line.slice(separator + 1).replace(/^ /, "");
    if (field === "event") result.event = value;
    else if (field === "id") result.id = value;
    else if (field === "data") data.push(value);
  }
  result.data = data.join("\n");
  return result;
}

function wait(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

module.exports = {
  DesktopControlCoordinator,
  DesktopSyncCoordinator,
  parseEventStream
};
