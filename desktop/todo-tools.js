(function exposeTodoTools(global) {
  const STORAGE_KEY = "xuan-todo-items-v1";
  const objectSchema = (properties, required = []) => ({
    type: "object",
    properties,
    required,
    additionalProperties: false
  });
  const stringField = (description) => ({ type: "string", description });

  function loadTodos() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  function saveTodos(todos) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(todos));
  }

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

  function parseTime(value, field) {
    const timestamp = new Date(value).getTime();
    if (!Number.isFinite(timestamp)) throw new Error(`${field} 必须是有效的 ISO 8601 时间`);
    return timestamp;
  }

  function localDateKey(timestamp) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  function registerTodoTools(registry) {
    registry.register({
      name: "todo.list",
      title: "查询待办",
      description: "查询待办列表，可按本地日期和完成状态筛选。",
      risk: "read",
      inputSchema: objectSchema({
        date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$", description: "本地日期，格式 YYYY-MM-DD" },
        status: { type: "string", enum: ["all", "active", "completed"], description: "完成状态，默认 all" }
      }),
      async execute(input) {
        const status = input.status || "all";
        const todos = loadTodos().filter((todo) => {
          let dateMatches = true;
          if (input.date) {
            const dayStart = new Date(`${input.date}T00:00:00`).getTime();
            const dayEnd = new Date(`${input.date}T23:59:59.999`).getTime();
            dateMatches = todo.startAt <= dayEnd && todo.endAt >= dayStart;
          }
          const statusMatches =
            status === "all" ||
            (status === "completed" ? todo.completed : !todo.completed);
          return dateMatches && statusMatches;
        });
        return {
          ok: true,
          content: `找到 ${todos.length} 条待办。`,
          data: todos.map(normalizeTodo)
        };
      }
    });

    registry.register({
      name: "todo.get",
      title: "查看待办",
      description: "根据待办 ID 获取完整信息。",
      risk: "read",
      inputSchema: objectSchema({ id: stringField("待办 ID") }, ["id"]),
      async execute(input) {
        const todo = loadTodos().find((item) => item.id === input.id);
        return todo
          ? { ok: true, content: `已找到待办“${todo.text}”。`, data: normalizeTodo(todo) }
          : failure("TODO_NOT_FOUND", "未找到指定待办。");
      }
    });

    registry.register({
      name: "todo.create",
      title: "新建待办",
      description: "创建一条有开始和结束时间的待办。",
      risk: "write",
      inputSchema: objectSchema({
        title: stringField("待办标题"),
        startAt: stringField("带时区的 ISO 8601 开始时间"),
        endAt: stringField("带时区的 ISO 8601 结束时间")
      }, ["title", "startAt", "endAt"]),
      async execute(input) {
        const title = String(input.title || "").trim();
        if (!title) return failure("INVALID_TITLE", "待办标题不能为空。");
        let startAt;
        let endAt;
        try {
          startAt = parseTime(input.startAt, "startAt");
          endAt = parseTime(input.endAt, "endAt");
        } catch (error) {
          return failure("INVALID_TIME", error.message);
        }
        if (endAt <= startAt) return failure("INVALID_TIME_RANGE", "结束时间必须晚于开始时间。");
        const todos = loadTodos();
        const todo = {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          text: title,
          startAt,
          endAt,
          completed: false,
          createdAt: Date.now()
        };
        todos.push(todo);
        saveTodos(todos);
        return { ok: true, content: `已创建待办“${title}”。`, data: normalizeTodo(todo) };
      }
    });

    registry.register({
      name: "todo.update",
      title: "修改待办",
      description: "修改已有待办的标题、开始时间或结束时间。",
      risk: "write",
      inputSchema: objectSchema({
        id: stringField("待办 ID"),
        title: stringField("新标题"),
        startAt: stringField("带时区的 ISO 8601 开始时间"),
        endAt: stringField("带时区的 ISO 8601 结束时间")
      }, ["id"]),
      async execute(input) {
        const todos = loadTodos();
        const todo = todos.find((item) => item.id === input.id);
        if (!todo) return failure("TODO_NOT_FOUND", "未找到指定待办。");
        if (!["title", "startAt", "endAt"].some((key) => input[key] !== undefined)) {
          return failure("NO_CHANGES", "没有提供需要修改的字段。");
        }
        const title = input.title === undefined ? todo.text : String(input.title).trim();
        if (!title) return failure("INVALID_TITLE", "待办标题不能为空。");
        let startAt;
        let endAt;
        try {
          startAt = input.startAt === undefined ? todo.startAt : parseTime(input.startAt, "startAt");
          endAt = input.endAt === undefined ? todo.endAt : parseTime(input.endAt, "endAt");
        } catch (error) {
          return failure("INVALID_TIME", error.message);
        }
        if (endAt <= startAt) return failure("INVALID_TIME_RANGE", "结束时间必须晚于开始时间。");
        Object.assign(todo, { text: title, startAt, endAt });
        saveTodos(todos);
        return { ok: true, content: `已更新待办“${title}”。`, data: normalizeTodo(todo) };
      }
    });

    registry.register({
      name: "todo.complete",
      title: "设置完成状态",
      description: "将待办设置为已完成或未完成。",
      risk: "write",
      inputSchema: objectSchema({
        id: stringField("待办 ID"),
        completed: { type: "boolean", description: "完成状态，省略时为 true" }
      }, ["id"]),
      async execute(input) {
        const todos = loadTodos();
        const todo = todos.find((item) => item.id === input.id);
        if (!todo) return failure("TODO_NOT_FOUND", "未找到指定待办。");
        todo.completed = input.completed === undefined ? true : Boolean(input.completed);
        saveTodos(todos);
        return {
          ok: true,
          content: `已将待办“${todo.text}”设为${todo.completed ? "已完成" : "未完成"}。`,
          data: normalizeTodo(todo)
        };
      }
    });

    registry.register({
      name: "todo.delete",
      title: "删除待办",
      description: "永久删除指定待办。",
      risk: "destructive",
      inputSchema: objectSchema({ id: stringField("待办 ID") }, ["id"]),
      async execute(input) {
        const todos = loadTodos();
        const index = todos.findIndex((item) => item.id === input.id);
        if (index < 0) return failure("TODO_NOT_FOUND", "未找到指定待办。");
        const [todo] = todos.splice(index, 1);
        saveTodos(todos);
        return { ok: true, content: `已删除待办“${todo.text}”。`, data: { id: todo.id } };
      }
    });

    return registry;
  }

  global.registerTodoTools = registerTodoTools;
})(window);
