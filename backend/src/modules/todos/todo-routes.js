function registerTodoRoutes(router, service) {
  router.add("GET", "/api/v1/todos", ({ userId, query }) => ({
    data: service.list(userId, query)
  }), { module: "todo" });
  router.add("GET", "/api/v1/todos/:id", ({ userId, params }) => ({
    data: service.get(userId, params.id)
  }), { module: "todo" });
  router.add("POST", "/api/v1/todos", ({ userId, body }) => ({
    status: 201,
    data: service.create(userId, body)
  }), { module: "todo" });
  router.add("PATCH", "/api/v1/todos/:id", ({ userId, params, body }) => ({
    data: service.update(userId, params.id, body)
  }), { module: "todo" });
  router.add("DELETE", "/api/v1/todos/completed", ({ userId }) => ({
    data: { deleted: service.repository.deleteCompleted(userId) }
  }), { module: "todo" });
  router.add("DELETE", "/api/v1/todos/:id", ({ userId, params }) => {
    service.delete(userId, params.id);
    return { status: 204 };
  }, { module: "todo" });
}

module.exports = { registerTodoRoutes };
