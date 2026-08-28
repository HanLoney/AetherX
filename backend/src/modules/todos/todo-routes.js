function registerTodoRoutes(router, service) {
  router.add("GET", "/api/v1/todos", ({ userId, query }) => ({
    data: service.list(userId, query)
  }), { module: "todo" });
  router.add("GET", "/api/v1/todos/:id", ({ userId, params }) => ({
    data: service.get(userId, params.id)
  }), { module: "todo" });
  router.add("POST", "/api/v1/todos", ({ userId, body, requestId }) => {
    const result = service.createWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  }, { module: "todo" });
  router.add("PATCH", "/api/v1/todos/:id", ({ userId, params, body, requestId }) => {
    const result = service.updateWithRequestId(userId, params.id, body, requestId);
    return { status: result.status, data: result.result };
  }, { module: "todo" });
  router.add("DELETE", "/api/v1/todos/completed", ({ userId, requestId }) => {
    const result = service.deleteCompletedWithRequestId(userId, requestId);
    return { status: result.status, data: result.result };
  }, { module: "todo" });
  router.add("DELETE", "/api/v1/todos/:id", ({ userId, params, requestId }) => {
    const result = service.deleteWithRequestId(userId, params.id, requestId);
    if (result.status !== 204) return { status: result.status, data: result.result };
    return { status: 204 };
  }, { module: "todo" });
}

module.exports = { registerTodoRoutes };
