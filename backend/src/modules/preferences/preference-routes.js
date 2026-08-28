function registerPreferenceRoutes(router, service) {
  router.add("GET", "/api/v1/preferences", ({ userId, query }) => ({
    data: service.list(userId, query)
  }), { module: "memory" });
  router.add("POST", "/api/v1/preferences", ({ userId, body, requestId }) => {
    const result = service.saveWithRequestId(userId, body, requestId, 201);
    return { status: result.status, data: result.result };
  }, { module: "memory" });
  router.add("PUT", "/api/v1/preferences", ({ userId, body, requestId }) => {
    const result = service.saveWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  }, { module: "memory" });
  router.add("DELETE", "/api/v1/preferences/:id", ({ userId, params, requestId }) => {
    const result = service.deleteWithRequestId(userId, params.id, requestId);
    if (result.status !== 204) return { status: result.status, data: result.result };
    return { status: 204 };
  }, { module: "memory" });
}

module.exports = { registerPreferenceRoutes };
