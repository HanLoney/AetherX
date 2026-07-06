const { HttpError } = require("../../lib/http-error");

const MIN_IMAGE_PIXELS = 3_686_400;
const DEFAULT_IMAGE_SIZE = "1920x1920";

function chatUrl(baseUrl) {
  return /\/chat\/completions$/i.test(baseUrl)
    ? baseUrl
    : `${baseUrl}/chat/completions`;
}

function imageUrl(baseUrl) {
  return /\/images\/generations$/i.test(baseUrl)
    ? baseUrl
    : `${baseUrl}/images/generations`;
}

class AiProviderClient {
  async chat(config, payload) {
    if (!config.apiKey) {
      throw new HttpError(400, "AI_KEY_REQUIRED", "请先配置 API Key。");
    }
    const messages = sanitizeMessages(payload.messages);
    if (!messages.length) {
      throw new HttpError(400, "MESSAGES_REQUIRED", "消息不能为空。");
    }
    const tools = sanitizeTools(payload.tools);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const response = await fetch(chatUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify({
          model: config.model,
          messages,
          ...(tools.length ? { tools, tool_choice: "auto" } : {}),
          stream: false
        }),
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: { message: text || `HTTP ${response.status}` } };
      }
      return { ok: response.ok, status: response.status, data };
    } catch (error) {
      if (error.name === "AbortError") {
        throw new HttpError(504, "AI_TIMEOUT", "AI 请求超时，请稍后重试。");
      }
      throw new HttpError(502, "AI_NETWORK_ERROR", error.message || "AI 请求失败。");
    } finally {
      clearTimeout(timer);
    }
  }

  async image(config, payload) {
    if (!config.apiKey) {
      throw new HttpError(400, "AI_IMAGE_KEY_REQUIRED", "请先配置图像生成 API Key。");
    }
    const imagePayload = sanitizeImagePayload(config, payload);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240_000);
    try {
      const response = await fetch(imageUrl(config.baseUrl), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`
        },
        body: JSON.stringify(imagePayload),
        signal: controller.signal
      });
      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        data = { error: { message: text || `HTTP ${response.status}` } };
      }
      return {
        ok: response.ok,
        status: response.status,
        data,
        images: normalizeImageResults(data)
      };
    } catch (error) {
      if (error.name === "AbortError") {
        throw new HttpError(504, "AI_IMAGE_TIMEOUT", "图像生成请求超时，请稍后重试。");
      }
      throw new HttpError(
        502,
        "AI_IMAGE_NETWORK_ERROR",
        error.message || "图像生成请求失败。"
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

function sanitizeMessages(value) {
  if (!Array.isArray(value)) return [];
  const messages = value.map(sanitizeMessage);
  const systemMessages = [];
  let historyStart = 0;
  while (messages[historyStart]?.role === "system") {
    systemMessages.push(messages[historyStart]);
    historyStart += 1;
  }

  const groups = groupValidHistory(messages.slice(historyStart));
  const budget = Math.max(1, 60 - systemMessages.length);
  const selected = [];
  let used = 0;
  for (let index = groups.length - 1; index >= 0; index -= 1) {
    const group = groups[index];
    if (used && used + group.length > budget) break;
    selected.unshift(group);
    used += group.length;
    if (used >= budget) break;
  }
  return [...systemMessages.slice(0, 4), ...selected.flat()];
}

function sanitizeMessage(message) {
  const role = ["system", "user", "assistant", "tool"].includes(message?.role)
    ? message.role
    : "user";
  const sanitized = {
    role,
    content:
      message?.content === null
        ? null
        : String(message?.content || "").slice(0, 30_000)
  };
  if (role === "assistant" && Array.isArray(message?.tool_calls)) {
    sanitized.tool_calls = message.tool_calls.slice(0, 10).map((call) => ({
      id: String(call?.id || "").slice(0, 200),
      type: "function",
      function: {
        name: String(call?.function?.name || "").slice(0, 100),
        arguments: String(call?.function?.arguments || "{}").slice(0, 20_000)
      }
    }));
  }
  if (role === "tool") {
    sanitized.tool_call_id = String(message?.tool_call_id || "").slice(0, 200);
  }
  return sanitized;
}

function groupValidHistory(messages) {
  const groups = [];
  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message.role === "tool") continue;
    if (message.role === "system") {
      groups.push([message]);
      continue;
    }
    if (message.role !== "assistant" || !message.tool_calls?.length) {
      groups.push([message]);
      continue;
    }

    const expectedIds = new Set(
      message.tool_calls.map((call) => call.id).filter(Boolean)
    );
    const tools = [];
    let cursor = index + 1;
    while (messages[cursor]?.role === "tool") {
      const tool = messages[cursor];
      if (
        expectedIds.has(tool.tool_call_id) &&
        !tools.some((item) => item.tool_call_id === tool.tool_call_id)
      ) {
        tools.push(tool);
      }
      cursor += 1;
    }
    if (expectedIds.size && tools.length === expectedIds.size) {
      groups.push([message, ...tools]);
    } else if (message.content) {
      const { tool_calls: _discarded, ...plainAssistant } = message;
      groups.push([plainAssistant]);
    }
    index = cursor - 1;
  }
  return groups;
}

function sanitizeTools(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((tool) => ({
    type: "function",
    function: {
      name: String(tool?.function?.name || "").slice(0, 100),
      description: String(tool?.function?.description || "").slice(0, 1000),
      parameters:
        tool?.function?.parameters &&
        typeof tool.function.parameters === "object"
          ? tool.function.parameters
          : { type: "object", properties: {} }
    }
  }));
}

function sanitizeImagePayload(config, payload = {}) {
  const prompt = String(payload.prompt || "").trim().slice(0, 8000);
  if (!prompt) {
    throw new HttpError(400, "AI_IMAGE_PROMPT_REQUIRED", "请输入图像生成提示词。");
  }
  const size = sanitizeImageSize(payload.size);
  const count = Math.min(Math.max(Number(payload.n || 1), 1), 4);
  const responseFormat = ["url", "b64_json"].includes(payload.responseFormat)
    ? payload.responseFormat
    : "url";
  const body = {
    model: String(payload.model || config.model || "").trim(),
    prompt,
    n: count,
    size,
    response_format: responseFormat,
    watermark: false
  };
  if (!body.model) {
    throw new HttpError(400, "AI_IMAGE_MODEL_REQUIRED", "请填写图像生成模型名称。");
  }
  if (payload.negativePrompt) {
    body.negative_prompt = String(payload.negativePrompt).slice(0, 4000);
  }
  if (payload.seed !== undefined && payload.seed !== "") {
    const seed = Number(payload.seed);
    if (Number.isInteger(seed)) body.seed = seed;
  }
  if (payload.guidanceScale !== undefined && payload.guidanceScale !== "") {
    const guidanceScale = Number(payload.guidanceScale);
    if (Number.isFinite(guidanceScale)) body.guidance_scale = guidanceScale;
  }
  return body;
}

function sanitizeImageSize(value) {
  const size = String(value || DEFAULT_IMAGE_SIZE).trim();
  const match = /^(\d{2,4})x(\d{2,4})$/.exec(size);
  if (!match) return DEFAULT_IMAGE_SIZE;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width * height >= MIN_IMAGE_PIXELS ? size : DEFAULT_IMAGE_SIZE;
}

function normalizeImageResults(data) {
  const candidates = Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.images)
      ? data.images
      : Array.isArray(data?.result?.data)
        ? data.result.data
        : [];
  return candidates
    .map((item) => ({
      url: String(item?.url || item?.image_url || item?.imageUrl || ""),
      b64Json: String(item?.b64_json || item?.b64Json || item?.base64 || ""),
      revisedPrompt: String(item?.revised_prompt || item?.revisedPrompt || "")
    }))
    .filter((item) => item.url || item.b64Json);
}

module.exports = {
  AiProviderClient,
  imageUrl,
  normalizeImageResults,
  sanitizeImagePayload,
  sanitizeMessages
};
