const { randomUUID } = require("node:crypto");

class ReplicatedTodoService {
  constructor(service, replicationUnitOfWork) {
    this.service = service;
    this.replicationUnitOfWork = replicationUnitOfWork;
  }

  list(userId, filters = {}) {
    return this.service.list(userId, filters);
  }

  get(userId, id) {
    return this.service.get(userId, id);
  }

  create(userId, input) {
    return this.createWithRequestId(userId, input, internalRequestId()).result;
  }

  createWithRequestId(userId, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const todo = this.service.create(userId, input);
      return { status: 201, result: todo, changes: [todoUpsert(todo)] };
    });
  }

  update(userId, id, input) {
    return this.updateWithRequestId(userId, id, input, internalRequestId()).result;
  }

  updateWithRequestId(userId, id, input, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const todo = this.service.update(userId, id, input);
      return { result: todo, changes: [todoUpsert(todo)] };
    });
  }

  delete(userId, id) {
    this.deleteWithRequestId(userId, id, internalRequestId());
  }

  deleteWithRequestId(userId, id, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const todo = this.service.get(userId, id);
      this.service.delete(userId, id);
      return { status: 204, result: null, changes: [todoDelete(todo)] };
    });
  }

  deleteCompleted(userId) {
    return this.deleteCompletedWithRequestId(userId, internalRequestId()).result.deleted;
  }

  deleteCompletedWithRequestId(userId, requestId) {
    return this.replicationUnitOfWork.execute(userId, requestId, () => {
      const completed = this.service.list(userId, { status: "completed" });
      const deleted = this.service.deleteCompleted(userId);
      return { result: { deleted }, changes: completed.map(todoDelete) };
    });
  }
}

function todoUpsert(todo) {
  return {
    entityType: "todos",
    entityId: todo.id,
    operation: "upsert",
    payload: {
      id: todo.id,
      text: todo.text,
      start_at: todo.startAt,
      end_at: todo.endAt,
      completed: Boolean(todo.completed),
      created_at: todo.createdAt,
      updated_at: todo.updatedAt
    }
  };
}

function todoDelete(todo) {
  return {
    entityType: "todos",
    entityId: todo.id,
    operation: "delete",
    payload: {
      id: todo.id,
      deleted_version_updated_at: todo.updatedAt
    }
  };
}

function internalRequestId() {
  return `internal:${randomUUID()}`;
}

module.exports = { ReplicatedTodoService, todoDelete, todoUpsert };
