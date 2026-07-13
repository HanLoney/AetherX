const TOPIC_ALIASES = Object.freeze([
  ["七大功能", ["七项功能", "七个功能", "功能规划", "功能进度"]],
  ["纪念册", ["我们的纪念册", "相册"]],
  ["梦境生成", ["梦境", "做梦"]],
  ["她的心情", ["小玄心情", "心情模块"]],
  ["下班", ["下班时间", "几点下班", "什么时候下班", "多久下班", "下班安排"]]
]);

const STOP_TERMS = new Set([
  "什么",
  "怎么",
  "时候",
  "多久",
  "还有",
  "时间",
  "几点",
  "安排",
  "一下",
  "这个",
  "那个",
  "知道",
  "用户"
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

function scoreTextMatch(content, query, expandedTerms = expandQueryTerms(query)) {
  const normalizedContent = normalizeText(content);
  const normalizedQuery = normalizeText(query);
  if (!normalizedContent || !normalizedQuery) return 0;
  if (
    normalizedContent.includes(normalizedQuery) ||
    normalizedQuery.includes(normalizedContent)
  ) {
    return 8;
  }

  const matchedTerms = [...new Set(expandedTerms)]
    .filter((term) => term.length >= 2 && !STOP_TERMS.has(term))
    .filter((term) => normalizedContent.includes(term));
  const maximalTerms = matchedTerms.filter(
    (term) =>
      !matchedTerms.some(
        (other) => other.length > term.length && other.includes(term)
      )
  );
  const termScore = Math.min(
    6,
    maximalTerms.reduce(
      (score, term) => score + Math.min(3, Math.max(1, term.length - 1)),
      0
    )
  );
  if (!termScore) return 0;
  const asksForTime = /(几点|什么时候|多久|时间)/u.test(normalizedQuery);
  const containsSpecificTime = /(?:\d{1,2}|[零〇一二两三四五六七八九十]{1,3})(?:点|时)(?:半|[零〇一二两三四五六七八九十\d]{1,3}分)?/u.test(
    normalizedContent
  );
  return termScore + (asksForTime && containsSpecificTime ? 2 : 0);
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
  scoreTextMatch,
  similarity
};
