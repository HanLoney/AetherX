window.AI_PROVIDER_PRESETS = [
  {
    id: "openai",
    name: "OpenAI",
    shortName: "OA",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-5.4-mini",
    color: "#72a7f2",
    description: "OpenAI 官方 API"
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    shortName: "DS",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    color: "#6378e8",
    description: "DeepSeek 开放平台"
  },
  {
    id: "qwen",
    name: "通义千问",
    shortName: "QW",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    color: "#7867e6",
    description: "阿里云百炼兼容接口"
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    shortName: "GL",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.1",
    color: "#45a6a1",
    description: "智谱开放平台"
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    shortName: "SF",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "Qwen/Qwen3-32B",
    color: "#e78b7c",
    description: "SiliconCloud 兼容接口"
  },
  {
    id: "custom",
    name: "自定义",
    shortName: "＋",
    baseUrl: "",
    model: "",
    color: "#9a93aa",
    description: "任意 OpenAI 兼容端点"
  }
];

window.AI_IMAGE_PROVIDER_PRESETS = [
  {
    id: "volcengine",
    name: "火山方舟",
    shortName: "HS",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seedream-5-0-260128",
    color: "#8a9bdc",
    description: "Doubao Seedream"
  },
  {
    id: "custom",
    name: "自定义",
    shortName: "＋",
    baseUrl: "",
    model: "",
    color: "#9a93aa",
    description: "兼容 /images/generations"
  }
];
