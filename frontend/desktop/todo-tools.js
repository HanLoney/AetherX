(function exposeTodoTools(global) {
  const objectSchema = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
  const stringField = (description) => ({ type: "string", description });

  function failure(code, message) {
    return { ok: false, content: message, error: { code, message } };
  }

  function normalizeTodo(todo) {
    return {
      id: todo.id,
      title: todo.text,
      startAt: new Date(todo.startAt).toISOString(),
      endAt: new Date(todo.endAt).toISOString(),
      completed: Boolean(todo.completed),
      createdAt: new Date(todo.createdAt || todo.startAt).toISOString()
    };
  }

  function apiFailure(error) {
    return failure(error.code || "TODO_API_ERROR", error.message || "待办服务请求失败。");
  }

  function registerTodoTools(registry) {
    registry.register({
      name: "todo.list",
      title: "查询待办",
      description: "查询待办列表，可按本地日期和完成状态筛选。",
      risk: "read",
      inputSchema: objectSchema({
        date: {
          type: "string",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
          description: "本地日期，格式 YYYY-MM-DD"
        },
        status: {
          type: "string",
          enum: ["all", "active", "completed"],
          description: "完成状态，默认 all"
        }
      }),
      async execute(input) {
        try {
          const todos = await global.desktop.listTodos({
            date: input.date,
            status: input.status || "all"
          });
          return {
            ok: true,
            content: `找到 ${todos.length} 条待办。`,
            data: todos.map(normalizeTodo)
          };
        } catch (error) {
          return apiFailure(error);
        }
      }
    });

    registry.register({
      name: "todo.get",
      title: "查看待办",
      description: "根据待办 ID 获取完整信息。",
      risk: "read",
      inputSchema: objectSchema({ id: stringField("待办 ID") }, ["id"]),
      async execute(input) {
        try {
          const todo = await global.desktop.getTodo(input.id);
          return {
            ok: true,
            content: `已找到待办“${todo.text}”。`,
            data: normalizeTodo(todo)
          };
        } catch (error) {
          return apiFailure(error);
        }
      }
    });

    registry.register({
      name: "todo.create",
      title: "新建待办",
      description: "创建一条有开始和结束时间的待办。",
      risk: "write",
      inputSchema: objectSchema(
        {
          title: stringField("待办标题"),
          startAt: stringField("带时区的 ISO 8601 开始时间"),
          endAt: stringField("带时区的 ISO 8601 结束时间")
        },
        ["title", "startAt", "endAt"]
      ),
      async execute(input) {
        try {
          const todo = await global.desktop.createTodo(input);
          return {
            ok: true,
            content: `已创建待办“${todo.text}”。`,
            data: normalizeTodo(todo)
          };
        } catch (error) {
          return apiFailure(error);
        }
      }
    });

    registry.register({
      name: "todo.update",
      title: "修改待办",
      description: "修改已有待办的标题、开始时间或结束时间。",
      risk: "write",
      inputSchema: objectSchema(
        {
          id: stringField("待办 ID"),
          title: stringField("新标题"),
          startAt: stringField("带时区的 ISO 8601 开始时间"),
          endAt: stringField("带时区的 ISO 8601 结束时间")
        },
        ["id"]
      ),
      async execute(input) {
        try {
          const todo = await global.desktop.updateTodo(input.id, {
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.startAt === undefined ? {} : { startAt: input.startAt }),
            ...(input.endAt === undefined ? {} : { endAt: input.endAt })
          });
          return {
            ok: true,
            content: `已更新待办“${todo.text}”。`,
            data: normalizeTodo(todo)
          };
        } catch (error) {
          return apiFailure(error);
        }
      }
    });

    registry.register({
      name: "todo.complete",
      title: "设置完成状态",
      description: "将待办设置为已完成或未完成。",
      risk: "write",
      inputSchema: objectSchema(
        {
          id: stringField("待办 ID"),
          completed: {
            type: "boolean",
            description: "完成状态，省略时为 true"
          }
        },
        ["id"]
      ),
      async execute(input) {
        try {
          const completed =
            input.completed === undefined ? true : Boolean(input.completed);
          const todo = await global.desktop.updateTodo(input.id, { completed });
          return {
            ok: true,
            content: `已将待办“${todo.text}”设为${completed ? "已完成" : "未完成"}。`,
            data: normalizeTodo(todo)
          };
        } catch (error) {
          return apiFailure(error);
        }
      }
    });

    registry.register({
      name: "todo.delete",
      title: "删除待办",
      description: "永久删除指定待办。",
      risk: "destructive",
      inputSchema: objectSchema({ id: stringField("待办 ID") }, ["id"]),
      async execute(input) {
        try {
          await global.desktop.deleteTodo(input.id);
          return {
            ok: true,
            content: "已删除指定待办。",
            data: { id: input.id }
          };
        } catch (error) {
          return apiFailure(error);
        }
      }
    });

    return registry;
  }

  global.registerTodoTools = registerTodoTools;
})(window);
