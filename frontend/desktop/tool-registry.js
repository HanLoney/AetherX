(function exposeToolRegistry(global) {
  const MODEL_RESULT_MAX_CHARS = 32_000;
  const MODEL_STRING_MAX_CHARS = 6_000;
  const MEDIA_PLACEHOLDER = "[内嵌媒体数据已省略，可通过媒体引用查看]";

  function sanitizeModelText(value, limit = MODEL_STRING_MAX_CHARS) {
    const maximum = Math.max(32, Number(limit) || MODEL_STRING_MAX_CHARS);
    const source = String(value ?? "");
    const withoutDataUrls = source
      .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+(?:;[a-z0-9.+-]+=[^;,]+)*(?:;base64)?,[a-z0-9+/_=-]+/gi, MEDIA_PLACEHOLDER)
      .replace(/(["'])(?:[a-z0-9+/_=-]{4096,})\1/gi, `$1${MEDIA_PLACEHOLDER}$1`);
    if (withoutDataUrls.length <= maximum) return withoutDataUrls;
    return `${withoutDataUrls.slice(0, maximum)}\n[内容过长，已截取前 ${maximum} 个字符]`;
  }

  function projectValue(value, options = {}, depth = 0) {
    const stringLimit = options.stringLimit || MODEL_STRING_MAX_CHARS;
    const arrayLimit = options.arrayLimit || 20;
    const maxDepth = options.maxDepth || 6;
    if (value === null || value === undefined || typeof value === "boolean" || typeof value === "number") {
      return value ?? null;
    }
    if (typeof value === "string") return sanitizeModelText(value, stringLimit);
    if (depth >= maxDepth) return "[嵌套数据已省略]";
    if (Array.isArray(value)) {
      return value.slice(0, arrayLimit).map((item) => projectValue(item, options, depth + 1));
    }
    if (typeof value !== "object") return sanitizeModelText(value, stringLimit);
    const result = {};
    for (const key of Object.keys(value).slice(0, 40)) {
      if (/^(image|avatar|personaImage)(DataUrl)?$/i.test(key)) {
        result[key] = MEDIA_PLACEHOLDER;
        continue;
      }
      result[key] = projectValue(value[key], options, depth + 1);
    }
    return result;
  }

  function projectToolResult(result) {
    const source = result && typeof result === "object" ? result : { ok: false, content: String(result || "") };
    const base = {
      ok: source.ok === true,
      content: sanitizeModelText(source.content || "", 4_000),
      ...(source.data === undefined ? {} : { data: projectValue(source.data) }),
      ...(source.error === undefined ? {} : { error: projectValue(source.error, { stringLimit: 2_000 }) })
    };
    if (JSON.stringify(base).length <= MODEL_RESULT_MAX_CHARS) return base;
    const compact = {
      ...base,
      ...(source.data === undefined
        ? {}
        : { data: projectValue(source.data, { stringLimit: 800, arrayLimit: 12, maxDepth: 4 }) })
    };
    if (JSON.stringify(compact).length <= MODEL_RESULT_MAX_CHARS) return compact;
    return {
      ok: base.ok,
      content: base.content,
      data: Array.isArray(source.data)
        ? { itemCount: source.data.length, note: "结果过大，模型仅保留摘要；完整数据仍在界面中可用。" }
        : { note: "结果过大，模型仅保留摘要；完整数据仍在界面中可用。" },
      ...(base.error === undefined ? {} : { error: base.error })
    };
  }

  class ToolRegistry {
    constructor(options = {}) {
      this.tools = new Map();
      this.isEnabled =
        typeof options.isEnabled === "function"
          ? options.isEnabled
          : () => true;
    }

    register(definition) {
      if (!definition?.name || typeof definition.execute !== "function") {
        throw new Error("工具定义不完整");
      }
      if (this.tools.has(definition.name)) {
        throw new Error(`工具名称重复：${definition.name}`);
      }
      const modelName = this.toModelName(definition.name);
      const modelNameExists = [...this.tools.values()].some(
        (tool) => this.toModelName(tool.name) === modelName
      );
      if (modelNameExists) {
        throw new Error(`工具模型名称重复：${modelName}`);
      }
      this.tools.set(definition.name, Object.freeze({ ...definition }));
      return this;
    }

    get(name) {
      const tool = this.resolve(name);
      return tool && this.isEnabled(tool.name, tool) ? tool : undefined;
    }

    modelTools() {
      return [...this.tools.values()]
        .filter((tool) => this.isEnabled(tool.name, tool))
        .map((tool) => ({
        type: "function",
        function: {
          name: this.toModelName(tool.name),
          description: tool.description,
          parameters: tool.inputSchema
        }
        }));
    }

    modelResult(name, result) {
      const tool = this.resolve(name);
      const projected = typeof tool?.projectResult === "function"
        ? tool.projectResult(result)
        : result;
      return projectToolResult(projected);
    }

    async call(name, rawInput) {
      const registeredTool = this.resolve(name);
      if (!registeredTool) {
        return this.failure("TOOL_NOT_FOUND", `未注册工具：${name}`);
      }
      if (!this.isEnabled(registeredTool.name, registeredTool)) {
        return this.failure("MODULE_DISABLED", `工具所属模块已停用：${name}`);
      }
      const tool = registeredTool;

      let input = rawInput;
      try {
        if (typeof rawInput === "string") {
          input = rawInput.trim() ? JSON.parse(rawInput) : {};
        }
        if (!input || typeof input !== "object" || Array.isArray(input)) {
          throw new Error("参数必须是 JSON 对象");
        }
      } catch (error) {
        return this.failure("INVALID_ARGUMENTS", `工具参数解析失败：${error.message}`);
      }

      this.coerce(tool.inputSchema, input);

      const validationError = this.validate(tool.inputSchema, input);
      if (validationError) {
        return this.failure("INVALID_ARGUMENTS", validationError);
      }

      try {
        const result = await tool.execute(input);
        if (result && typeof result.ok === "boolean" && result.content) {
          return result;
        }
        return this.failure("INVALID_TOOL_RESULT", "工具返回了无效结果");
      } catch (error) {
        return this.failure("TOOL_EXECUTION_FAILED", error.message || "工具执行失败");
      }
    }

    failure(code, message) {
      return { ok: false, content: message, error: { code, message } };
    }

    toModelName(name) {
      return name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
    }

    resolve(name) {
      return (
        this.tools.get(name) ||
        [...this.tools.values()].find(
          (tool) => this.toModelName(tool.name) === name
        )
      );
    }

    coerce(schema, value) {
      if (!schema || schema.type !== "object") return;
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      for (const [key, childSchema] of Object.entries(schema.properties || {})) {
        const current = value[key];
        if (current === undefined) continue;
        if (childSchema.type === "boolean" && typeof current === "string") {
          const normalized = current.trim().toLowerCase();
          if (normalized === "true") value[key] = true;
          else if (normalized === "false") value[key] = false;
        } else if (childSchema.type === "number" && typeof current === "string") {
          const numeric = Number(current.trim());
          if (current.trim() !== "" && !Number.isNaN(numeric)) value[key] = numeric;
        } else if (childSchema.type === "object") {
          this.coerce(childSchema, current);
        }
      }
    }

    validate(schema, value, path = "参数") {
      if (!schema) return "";
      if (schema.type === "object") {
        if (!value || typeof value !== "object" || Array.isArray(value)) {
          return `${path}必须是对象`;
        }
        for (const key of schema.required || []) {
          if (value[key] === undefined) return `${path}.${key} 为必填项`;
        }
        if (schema.additionalProperties === false) {
          const unknown = Object.keys(value).find(
            (key) => !Object.prototype.hasOwnProperty.call(schema.properties || {}, key)
          );
          if (unknown) return `${path}.${unknown} 不是允许的字段`;
        }
        for (const [key, childSchema] of Object.entries(schema.properties || {})) {
          if (value[key] === undefined) continue;
          const error = this.validate(childSchema, value[key], `${path}.${key}`);
          if (error) return error;
        }
      }
      if (schema.type === "string" && typeof value !== "string") {
        return `${path}必须是字符串`;
      }
      if (schema.type === "boolean" && typeof value !== "boolean") {
        return `${path}必须是布尔值`;
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return `${path}必须是以下值之一：${schema.enum.join("、")}`;
      }
      if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) {
        return `${path}格式不正确`;
      }
      return "";
    }
  }

  global.XuanToolRegistry = ToolRegistry;
  global.XuanModelContext = Object.freeze({
    projectToolResult,
    sanitizeText: sanitizeModelText
  });
  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ToolRegistry, projectToolResult, sanitizeModelText };
  }
})(typeof window === "undefined" ? globalThis : window);
