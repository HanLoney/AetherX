(function exposeGalleryLayout(global) {
  function toValidDate(value) {
    if (value === null || value === undefined || value === "") return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatGalleryDate(value) {
    const date = toValidDate(value);
    if (!date) return "时间未记录";
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date).replaceAll("/", ".");
  }

  function groupGalleryByMonth(items) {
    const groups = new Map();
    for (const item of Array.isArray(items) ? items : []) {
      const date = toValidDate(item.createdAt);
      const key = date
        ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
        : "unknown";
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          label: date
            ? `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`
            : "未记录时间",
          items: []
        });
      }
      groups.get(key).items.push(item);
    }
    return [...groups.values()];
  }

  const api = { formatGalleryDate, groupGalleryByMonth };
  global.XuanGalleryLayout = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
