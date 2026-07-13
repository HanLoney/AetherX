(function exposeClock(global) {
  class AetherClock {
    constructor(options) {
      this.element = options.element;
      this.hourMinuteElement = options.hourMinuteElement;
      this.secondElement = options.secondElement;
      this.now = options.now || (() => new Date());
      this.setTimeout = options.setTimeout || global.setTimeout.bind(global);
      this.clearTimeout = options.clearTimeout || global.clearTimeout.bind(global);
      this.timer = null;
      this.formatter = new Intl.DateTimeFormat(options.locale || "zh-CN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      });
    }

    start() {
      if (this.timer !== null) return;
      this.render();
      this.schedule();
    }

    stop() {
      if (this.timer === null) return;
      this.clearTimeout(this.timer);
      this.timer = null;
    }

    render() {
      const current = this.now();
      const parts = Object.fromEntries(
        this.formatter
          .formatToParts(current)
          .filter((part) => ["hour", "minute", "second"].includes(part.type))
          .map((part) => [part.type, part.value])
      );
      const hourMinute = `${parts.hour || "00"}:${parts.minute || "00"}`;
      const second = parts.second || "00";
      this.hourMinuteElement.textContent = hourMinute;
      this.secondElement.textContent = second;
      this.element.dateTime = current.toISOString();
      this.element.setAttribute(
        "aria-label",
        `当前时间 ${hourMinute}:${second}`
      );
    }

    schedule() {
      const current = this.now();
      const delay = Math.max(20, 1000 - current.getMilliseconds());
      this.timer = this.setTimeout(() => {
        this.timer = null;
        this.render();
        this.schedule();
      }, delay);
    }
  }

  global.AetherClock = AetherClock;
  if (typeof module !== "undefined") {
    module.exports = { AetherClock };
  }
})(typeof window === "undefined" ? globalThis : window);
