const MODULE_MANIFEST = Object.freeze([
  moduleDefinition({
    id: "ai",
    name: "聊天",
    description: "负责对话、理解意图并调度已启用的能力。",
    core: true
  }),
  moduleDefinition({
    id: "memory",
    name: "记忆中心",
    description: "管理长期记忆、偏好、共同经历与人格成长记录。",
    toolPrefixes: [
      "memory.",
      "preference.",
      "personality_event.",
      "shared_memory."
    ]
  }),
  moduleDefinition({
    id: "todo",
    name: "日历待办",
    description: "管理日程、待办、完成状态与跨日期安排。",
    toolPrefixes: ["todo."]
  }),
  moduleDefinition({
    id: "wallet",
    name: "钱包",
    description: "记录多项存款余额，并支持在对话中查询和调整。",
    toolPrefixes: ["wallet."]
  }),
  moduleDefinition({
    id: "image-generation",
    name: "图像生成",
    description: "调用独立图像模型生成并保存图片。",
    toolPrefixes: ["image."]
  }),
  moduleDefinition({
    id: "time-awareness",
    name: "时间感知",
    description: "为对话提供用户当地时间、时区和交互间隔。"
  }),
  moduleDefinition({
    id: "xuan-mood",
    name: "她的心情",
    description: "根据真实互动维护连续变化的心情状态。"
  }),
  moduleDefinition({
    id: "proactive-reminders",
    name: "主动提醒",
    description: "根据待办时间主动发送提醒。",
    dependencies: ["todo"]
  }),
  moduleDefinition({
    id: "autonomous-journal",
    name: "自主手记",
    description: "读取真实历史并生成日记、周记。",
    toolPrefixes: ["journal."]
  }),
  moduleDefinition({
    id: "anniversary-album",
    name: "我们的纪念册",
    description: "整理共同经历并形成可回顾的纪念时间轴。",
    toolPrefixes: ["album."]
  }),
  moduleDefinition({
    id: "dreams",
    name: "梦境",
    description: "根据真实素材生成明确标记为虚构的梦境。",
    toolPrefixes: ["dream."]
  })
]);

const MODULE_BY_ID = new Map(MODULE_MANIFEST.map((module) => [module.id, module]));

function moduleDefinition(input) {
  return Object.freeze({
    id: input.id,
    name: input.name,
    description: input.description,
    core: input.core === true,
    defaultEnabled: input.core === true || input.defaultEnabled !== false,
    dependencies: Object.freeze([...(input.dependencies || [])]),
    toolPrefixes: Object.freeze([...(input.toolPrefixes || [])])
  });
}

function moduleForTool(toolName) {
  const name = String(toolName || "");
  return MODULE_MANIFEST.find((module) =>
    module.toolPrefixes.some((prefix) => name.startsWith(prefix))
  )?.id || "";
}

module.exports = { MODULE_BY_ID, MODULE_MANIFEST, moduleForTool };
