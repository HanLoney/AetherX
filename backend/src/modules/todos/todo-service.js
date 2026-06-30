const { randomUUID } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");

class TodoService {
  constructor(repository) {
    this.repository = repository;
  }

  list(userId, filters = {}) {
    return this.repository.list(userId).filter((todo) => {
      const statusMatches =
        !filters.status ||
        filters.status === "all" ||
        (filters.status === "completed" ? todo.completed : !todo.completed);
      if (!statusMatches) return false;
      if (!filters.date) return true;
      const start = new Date(`${filters.date}T00:00:00`).getTime();
      const end = new Date(`${filters.date}T23:59:59.999`).getTime();
      return todo.startAt <= end && todo.endAt >= start;
    });
  }

  get(userId, id) {
    const todo = this.repository.findById(userId, id);
    if (!todo) throw new HttpError(404, "TODO_NOT_FOUND", "未找到指定待办。");
    return todo;
  }

  create(userId, input) {
    const values = validateTodo(input);
    const now = Date.now();
    return this.repository.create(userId, {
      id: randomUUID(),
      ...values,
      completed: Boolean(input.completed),
      createdAt: now,
      updatedAt: now
    });
  }

  update(userId, id, input) {
    const current = this.get(userId, id);
    const values = validateTodo({
      text: input.text ?? input.title ?? current.text,
      startAt: input.startAt ?? current.startAt,
      endAt: input.endAt ?? current.endAt
    });
    return this.repository.update(userId, id, {
      ...values,
      completed:
        input.completed === undefined
          ? current.completed
          : Boolean(input.completed)
    });
  }

  delete(userId, id) {
    if (!this.repository.delete(userId, id)) {
      throw new HttpError(404, "TODO_NOT_FOUND", "未找到指定待办。");
    }
  }
}

function validateTodo(input) {
  const text = String(input.text ?? input.title ?? "").trim();
  const startAt = new Date(input.startAt).getTime();
  const endAt = new Date(input.endAt).getTime();
  if (!text) throw new HttpError(400, "INVALID_TITLE", "待办标题不能为空。");
  if (!Number.isFinite(startAt) || !Number.isFinite(endAt)) {
    throw new HttpError(400, "INVALID_TIME", "待办时间格式不正确。");
  }
  if (endAt <= startAt) {
    throw new HttpError(
      400,
      "INVALID_TIME_RANGE",
      "结束时间必须晚于开始时间。"
    );
  }
  return { text, startAt, endAt };
}

module.exports = { TodoService };
