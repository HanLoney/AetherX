const assert = require("node:assert/strict");
const test = require("node:test");
const { AetherClock } = require("../clock");

function element() {
  return {
    dateTime: "",
    attributes: {},
    setAttribute(name, value) {
      this.attributes[name] = value;
    }
  };
}

test("clock renders stable two-digit time and schedules the next second", () => {
  const root = element();
  const hourMinute = { textContent: "" };
  const second = { textContent: "" };
  let scheduled;
  const clock = new AetherClock({
    element: root,
    hourMinuteElement: hourMinute,
    secondElement: second,
    locale: "zh-CN",
    now: () => new Date("2026-01-02T03:04:05.250Z"),
    setTimeout: (callback, delay) => {
      scheduled = { callback, delay };
      return 1;
    },
    clearTimeout: () => {}
  });

  clock.start();

  assert.match(hourMinute.textContent, /^\d{2}:\d{2}$/);
  assert.equal(second.textContent, "05");
  assert.equal(scheduled.delay, 750);
  assert.match(root.attributes["aria-label"], /^当前时间 \d{2}:\d{2}:05$/);
});

test("clock start and stop are idempotent", () => {
  let scheduledCount = 0;
  let clearedCount = 0;
  const clock = new AetherClock({
    element: element(),
    hourMinuteElement: { textContent: "" },
    secondElement: { textContent: "" },
    now: () => new Date("2026-01-02T03:04:05.000Z"),
    setTimeout: () => {
      scheduledCount += 1;
      return 7;
    },
    clearTimeout: () => {
      clearedCount += 1;
    }
  });

  clock.start();
  clock.start();
  clock.stop();
  clock.stop();

  assert.equal(scheduledCount, 1);
  assert.equal(clearedCount, 1);
});
