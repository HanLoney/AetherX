(function exposeReminderEngine(global) {
  const DEFAULT_INTERVAL_MS = 30_000;
  const DEFAULT_LEAD_MS = 10 * 60_000;
  const LEDGER_MAX_AGE_MS = 30 * 24 * 60 * 60_000;

  class AetherReminderEngine {
    constructor(options) {
      this.listTodos = options.listTodos;
      this.onReminder = options.onReminder;
      this.onError = options.onError || (() => {});
      this.isEnabled = options.isEnabled;
      this.storage = options.storage;
      this.now = options.now || (() => Date.now());
      this.intervalMs = options.intervalMs || DEFAULT_INTERVAL_MS;
      this.leadMs = options.leadMs || DEFAULT_LEAD_MS;
      this.storageKey =
        options.storageKey || "aetherx-reminder-delivery-ledger-v1";
      this.timer = null;
      this.checking = false;
    }

    start() {
      if (this.timer) return;
      this.runCheck();
      this.timer = global.setInterval(() => this.runCheck(), this.intervalMs);
    }

    stop() {
      if (!this.timer) return;
      global.clearInterval(this.timer);
      this.timer = null;
    }

    async check() {
      if (this.checking || !this.isEnabled()) return [];
      this.checking = true;
      try {
        const currentTime = this.now();
        const todos = await this.listTodos({ status: "active" });
        const ledger = this.readLedger(currentTime);
        const reminders = [];
        for (const todo of todos) {
          const reminder = this.reminderFor(todo, currentTime);
          if (!reminder) continue;
          const deliveryKey = this.deliveryKey(todo, reminder.phase);
          if (ledger[deliveryKey]) continue;
          await this.onReminder(reminder);
          ledger[deliveryKey] = currentTime;
          this.writeLedger(ledger);
          reminders.push(reminder);
        }
        return reminders;
      } finally {
        this.checking = false;
      }
    }

    async runCheck() {
      try {
        return await this.check();
      } catch (error) {
        this.onError(error);
        return [];
      }
    }

    reminderFor(todo, currentTime) {
      if (!todo || todo.completed) return null;
      const startAt = Number(todo.startAt);
      const endAt = Number(todo.endAt);
      if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) return null;

      const base = {
        todoId: todo.id,
        text: todo.text,
        startAt,
        endAt
      };
      if (currentTime >= startAt - this.leadMs && currentTime < startAt) {
        const minutes = Math.max(1, Math.ceil((startAt - currentTime) / 60_000));
        return {
          ...base,
          phase: "upcoming",
          title: "待办即将开始",
          body: `「${todo.text}」还有 ${minutes} 分钟开始。`
        };
      }
      if (currentTime >= startAt && currentTime <= endAt) {
        return {
          ...base,
          phase: "due",
          title: "待办已经到时间",
          body: `「${todo.text}」已经到时间了。`
        };
      }
      if (
        currentTime > endAt &&
        currentTime <= endAt + 24 * 60 * 60_000
      ) {
        return {
          ...base,
          phase: "overdue",
          title: "待办还没有完成",
          body: `「${todo.text}」已经超过计划结束时间，记得确认一下进度。`
        };
      }
      return null;
    }

    deliveryKey(todo, phase) {
      return [
        todo.id,
        Number(todo.updatedAt) || 0,
        Number(todo.startAt) || 0,
        Number(todo.endAt) || 0,
        phase
      ].join(":");
    }

    readLedger(currentTime) {
      try {
        const parsed = JSON.parse(this.storage.getItem(this.storageKey) || "{}");
        return Object.fromEntries(
          Object.entries(parsed).filter(
            ([, deliveredAt]) =>
              currentTime - Number(deliveredAt) <= LEDGER_MAX_AGE_MS
          )
        );
      } catch {
        return {};
      }
    }

    writeLedger(ledger) {
      this.storage.setItem(this.storageKey, JSON.stringify(ledger));
    }
  }

  global.AetherReminderEngine = AetherReminderEngine;
  if (typeof module !== "undefined") {
    module.exports = { AetherReminderEngine };
  }
})(typeof window === "undefined" ? globalThis : window);
