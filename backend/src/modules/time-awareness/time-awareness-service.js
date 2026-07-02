const PERIODS = [
  { start: 0, end: 5, id: "late-night", label: "深夜" },
  { start: 5, end: 8, id: "early-morning", label: "清晨" },
  { start: 8, end: 12, id: "morning", label: "上午" },
  { start: 12, end: 14, id: "noon", label: "中午" },
  { start: 14, end: 18, id: "afternoon", label: "下午" },
  { start: 18, end: 22, id: "evening", label: "晚上" },
  { start: 22, end: 24, id: "late-evening", label: "夜里" }
];

class TimeAwarenessService {
  constructor(repository) {
    this.repository = repository;
  }

  getContext(userId, input = {}) {
    const now = validTimestamp(input.now) || Date.now();
    const timeZone = validTimeZone(input.timeZone) || "Asia/Shanghai";
    const locale = String(input.locale || "zh-CN").slice(0, 30);
    const current = localParts(now, timeZone, locale);
    const cutoff = now - 1000;
    const lastInteractionAt = this.repository.getLastUserInteraction(
      userId,
      cutoff
    );
    const last = lastInteractionAt
      ? localParts(lastInteractionAt, timeZone, locale)
      : null;
    const elapsedMs = lastInteractionAt
      ? Math.max(0, now - lastInteractionAt)
      : null;
    const isFirstInteractionToday =
      !last || localDateKey(last) !== localDateKey(current);
    const period = periodForHour(current.hour);

    return {
      now,
      timeZone,
      locale,
      localDate: localDateKey(current),
      localTime: `${pad(current.hour)}:${pad(current.minute)}`,
      weekday: current.weekday,
      period: period.id,
      periodLabel: period.label,
      lastInteractionAt,
      elapsedMs,
      elapsedLabel: elapsedLabel(elapsedMs),
      isFirstInteractionToday,
      context: buildContext({
        current,
        timeZone,
        period,
        last,
        elapsedMs,
        isFirstInteractionToday
      })
    };
  }
}

function buildContext({
  current,
  timeZone,
  period,
  last,
  elapsedMs,
  isFirstInteractionToday
}) {
  const lines = [
    "[权威运行时事实：时间感知]",
    `用户当地日期：${localDateKey(current)}`,
    `用户当地时间：${pad(current.hour)}:${pad(current.minute)}`,
    `星期：${current.weekday}`,
    `时区：${timeZone}`,
    `当前时段：${period.label}`,
    last
      ? `上次互动：${localDateKey(last)} ${pad(last.hour)}:${pad(last.minute)}（${elapsedLabel(elapsedMs)}）`
      : "上次互动：这是已记录对话中的首次互动",
    `今天首次互动：${isFirstInteractionToday ? "是" : "否"}`,
    "以上时间由系统在本轮请求开始时实时读取，是当前时间的唯一权威来源。它高于历史对话、长期记忆、待办时间戳和模型推测；发生冲突时必须以此处为准。",
    "本消息是临近当前用户轮次注入的瞬时上下文，不属于聊天历史。此前对话中所有“现在是几点”“今天是哪天”等说法都只代表当时或当时的错误判断，不得用于推断本轮时间。",
    "用户询问当前日期、星期、时段或时间时，直接根据以上事实回答。禁止调用待办或记忆工具验证时间，也禁止创建临时数据反推时间。",
    "这些信息只用于理解当下情境和时间流逝。除非用户明确询问，否则不要主动报日期、星期或具体时间。",
    "可以根据分别时长和当前时段自然调整语气，但不要每次都提到时间，也不要编造等待期间发生的经历。"
  ];
  return lines.join("\n");
}

function localParts(timestamp, timeZone, locale) {
  const parts = new Intl.DateTimeFormat(locale, {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(timestamp);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [
      part.type,
      part.value
    ])
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: values.weekday
  };
}

function periodForHour(hour) {
  return (
    PERIODS.find((period) => hour >= period.start && hour < period.end) ||
    PERIODS[0]
  );
}

function elapsedLabel(value) {
  if (value === null) return "首次互动";
  if (value < 60 * 1000) return "刚刚";
  if (value < 60 * 60 * 1000) return `${Math.floor(value / 60000)} 分钟前`;
  if (value < 24 * 60 * 60 * 1000) {
    const hours = Math.floor(value / 3600000);
    const minutes = Math.floor((value % 3600000) / 60000);
    return minutes ? `${hours} 小时 ${minutes} 分钟前` : `${hours} 小时前`;
  }
  const days = Math.floor(value / 86400000);
  return `${days} 天前`;
}

function localDateKey(parts) {
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function validTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function validTimeZone(value) {
  const timeZone = String(value || "").trim();
  if (!timeZone) return "";
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone }).format();
    return timeZone;
  } catch {
    return "";
  }
}

module.exports = {
  TimeAwarenessService,
  elapsedLabel,
  periodForHour
};
