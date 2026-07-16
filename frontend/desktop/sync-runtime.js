class DesktopSyncCoordinator {
  constructor(options) {
    this.api = options.api;
    this.onChanges = options.onChanges;
    this.pollIntervalMs = Math.max(250, Number(options.pollIntervalMs) || 900);
    this.retryIntervalMs = Math.max(1000, Number(options.retryIntervalMs) || 3000);
    this.cursor = 0;
    this.scope = "";
    this.running = false;
    this.primed = false;
    this.generation = 0;
    this.timer = null;
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
      this.schedule(generation, this.primed ? 0 : this.retryIntervalMs);
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

module.exports = { DesktopSyncCoordinator };
