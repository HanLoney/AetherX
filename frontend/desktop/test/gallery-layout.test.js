const test = require("node:test");
const assert = require("node:assert/strict");
const { formatGalleryDate, groupGalleryByMonth } = require("../gallery-layout");

test("gallery dates include the recorded day and time", () => {
  const label = formatGalleryDate(new Date(2026, 6, 7, 9, 5).getTime());
  assert.match(label, /2026\.07\.07/);
  assert.match(label, /09:05/);
  assert.equal(formatGalleryDate("not-a-date"), "时间未记录");
  assert.equal(formatGalleryDate(null), "时间未记录");
});

test("gallery items are grouped into chronological album sections", () => {
  const groups = groupGalleryByMonth([
    { id: "a", createdAt: new Date(2026, 6, 7).getTime() },
    { id: "b", createdAt: new Date(2026, 6, 2).getTime() },
    { id: "c", createdAt: new Date(2026, 5, 30).getTime() }
  ]);
  assert.deepEqual(groups.map((group) => group.items.map((item) => item.id)), [
    ["a", "b"],
    ["c"]
  ]);
  assert.deepEqual(groups.map((group) => group.label), ["2026 年 7 月", "2026 年 6 月"]);
});
