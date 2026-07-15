const assert = require("node:assert/strict");
const test = require("node:test");
const { AetherAlbumPager } = require("../album-pager");

test("album pager turns through moments without leaving its bounds", () => {
  const pager = new AetherAlbumPager([{ id: "a" }, { id: "b" }, { id: "c" }]);

  assert.deepEqual(pager.snapshot(), {
    item: { id: "a" },
    index: 0,
    total: 3,
    hasPrevious: false,
    hasNext: true
  });
  assert.equal(pager.move(1).item.id, "b");
  assert.equal(pager.move(20).item.id, "c");
  assert.equal(pager.move(-20).item.id, "a");
});

test("album pager can preserve the currently open memory after refresh", () => {
  const pager = new AetherAlbumPager([{ id: "a" }, { id: "b" }]);
  pager.move(1);

  const snapshot = pager.setItems(
    [{ id: "new" }, { id: "b" }, { id: "a" }],
    { preserveCurrent: true }
  );

  assert.equal(snapshot.item.id, "b");
  assert.equal(snapshot.index, 1);
});

test("album pager resets to the first result for a new search", () => {
  const pager = new AetherAlbumPager([{ id: "a" }, { id: "b" }]);
  pager.move(1);

  const snapshot = pager.setItems([{ id: "result" }]);
  assert.equal(snapshot.item.id, "result");
  assert.equal(snapshot.index, 0);
});
