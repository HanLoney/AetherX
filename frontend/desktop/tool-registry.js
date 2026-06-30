(function exposeToolRegistry(global) {
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
})(window);
