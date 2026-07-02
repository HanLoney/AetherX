const test = require("node:test");
const assert = require("node:assert/strict");
const {
  AetherReminderEngine
} = require("../reminder-engine");

function createStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.get(key) || null;
    },
    setItem(key, value) {
      values.set(key, value);
    }
  };
}

function todo(overrides = {}) {
  return {
    id: "todo-1",
    text: "整理产品路线图",
    startAt: 1_000_000,
    endAt: 1_600_000,
    completed: false,
    updatedAt: 10,
    ...overrides
  };
}

function createEngine({ now, todos, enabled = true }) {
  const delivered = [];
  return {
    delivered,
    engine: new AetherReminderEngine({
      now: () => now.value,
      listTodos: async () => todos.value,
      onReminder: async (reminder) => delivered.push(reminder),
      isEnabled: () => enabled,
      storage: createStorage()
    })
  };
}

test("reminds before, during and after an active todo only once per phase", async () => {
  const now = { value: 500_000 };
  const todos = { value: [todo()] };
  const { engine, delivered } = createEngine({ now, todos });

  await engine.check();
  await engine.check();
  assert.deepEqual(delivered.map((item) => item.phase), ["upcoming"]);

  now.value = 1_100_000;
  await engine.check();
  await engine.check();
  assert.deepEqual(delivered.map((item) => item.phase), ["upcoming", "due"]);

  now.value = 1_700_000;
  await engine.check();
  await engine.check();
  assert.deepEqual(
    delivered.map((item) => item.phase),
    ["upcoming", "due", "overdue"]
  );
});

test("editing a todo creates a new reminder delivery identity", async () => {
  const now = { value: 1_100_000 };
  const todos = { value: [todo()] };
  const { engine, delivered } = createEngine({ now, todos });

  await engine.check();
  todos.value = [todo({ updatedAt: 20, text: "整理新版产品路线图" })];
  await engine.check();

  assert.equal(delivered.length, 2);
  assert.equal(delivered[1].text, "整理新版产品路线图");
});

test("disabled reminders do not query todos", async () => {
  let queryCount = 0;
  const engine = new AetherReminderEngine({
    listTodos: async () => {
      queryCount += 1;
      return [];
    },
    onReminder: async () => {},
    isEnabled: () => false,
    storage: createStorage()
  });

  assert.deepEqual(await engine.check(), []);
  assert.equal(queryCount, 0);
});
