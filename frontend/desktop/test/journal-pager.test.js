const assert = require("node:assert/strict");
const test = require("node:test");
const { AetherJournalPager } = require("../journal-pager");

const journals = [
  { id: "daily-2", type: "daily" },
  { id: "weekly-1", type: "weekly" },
  { id: "daily-1", type: "daily" }
];

test("journal pager moves one entry at a time and clamps at both ends", () => {
  const pager = new AetherJournalPager(journals);
  assert.equal(pager.snapshot().item.id, "daily-2");
  assert.equal(pager.move(1).item.id, "weekly-1");
  assert.equal(pager.move(1).item.id, "daily-1");
  assert.equal(pager.move(1).item.id, "daily-1");
  assert.equal(pager.move(-10).item.id, "daily-2");
});

test("journal pager resets to the first page when filter changes", () => {
  const pager = new AetherJournalPager(journals);
  pager.move(2);
  const daily = pager.setFilter("daily");
  assert.equal(daily.index, 0);
  assert.equal(daily.total, 2);
  assert.equal(daily.item.id, "daily-2");
  assert.equal(daily.hasPrevious, false);
  assert.equal(daily.hasNext, true);
});

test("journal pager keeps a valid page after items are removed", () => {
  const pager = new AetherJournalPager(journals);
  pager.move(2);
  const snapshot = pager.setItems(journals.slice(0, 2));
  assert.equal(snapshot.index, 1);
  assert.equal(snapshot.item.id, "weekly-1");
});
