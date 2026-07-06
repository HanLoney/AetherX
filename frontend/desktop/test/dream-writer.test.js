const test = require("node:test");
const assert = require("node:assert/strict");
const {
  previousDreamPeriod,
  parseDream
} = require("../dream-writer");

test("dream writer targets the previous local day", () => {
  const period = previousDreamPeriod(new Date(2026, 6, 6, 9).getTime());
  assert.equal(period.dreamDate, "2026-07-05");
  assert.equal(period.to - period.from, 24 * 60 * 60_000);
});

test("dream parsing keeps an explicit fictional boundary", () => {
  const dream = parseDream(
    '{"title":"云上的车站","content":"车站漂起来，灯变成了月亮。","symbols":["车站","灯"]}',
    "2026-07-05"
  );
  assert.match(dream.content, /梦/);
  assert.match(dream.realityNote, /虚构梦境/);
  assert.deepEqual(dream.symbols, ["车站", "灯"]);
});
