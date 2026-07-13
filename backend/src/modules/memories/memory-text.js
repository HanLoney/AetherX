const TOPIC_ALIASES = Object.freeze([
  ["七大功能", ["七项功能", "七个功能", "功能规划", "功能进度"]],
  ["纪念册", ["我们的纪念册", "相册"]],
  ["梦境生成", ["梦境", "做梦"]],
  ["她的心情", ["小玄心情", "心情模块"]]
]);

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
}

function characterNgrams(value, sizes = [2, 3, 4]) {
  const normalized = normalizeText(value);
  const result = new Set();
  for (const size of sizes) {
    for (let index = 0; index <= normalized.length - size; index += 1) {
      result.add(normalized.slice(index, index + size));
    }
  }
  return result;
}

function expandQueryTerms(value) {
  const normalized = normalizeText(value);
  const terms = characterNgrams(normalized);
  if (normalized.length >= 2) terms.add(normalized);
  for (const [topic, aliases] of TOPIC_ALIASES) {
    const family = [topic, ...aliases].map(normalizeText);
    if (!family.some((item) => normalized.includes(item))) continue;
    family.forEach((item) => {
      terms.add(item);
      characterNgrams(item).forEach((term) => terms.add(term));
    });
  }
  return [...terms].filter((term) => term.length >= 2).slice(0, 120);
}

function similarity(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b || a.includes(b) || b.includes(a)) return 1;
  const leftPairs = characterNgrams(a, [2]);
  const rightPairs = characterNgrams(b, [2]);
  const overlap = [...leftPairs].filter((item) => rightPairs.has(item)).length;
  return leftPairs.size + rightPairs.size
    ? (2 * overlap) / (leftPairs.size + rightPairs.size)
    : 0;
}

module.exports = {
  characterNgrams,
  expandQueryTerms,
  normalizeText,
  similarity
};
