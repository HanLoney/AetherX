const { HttpError } = require("../../lib/http-error");

function chatUrl(baseUrl) {
  return /\/chat\/completions$/i.test(baseUrl)
    ? baseUrl
    : `${baseUrl}/chat/completions`;
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
}

function sanitizeMessages(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-60).map((message) => {
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
  });
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

module.exports = { AiProviderClient };
