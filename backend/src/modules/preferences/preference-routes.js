function registerPreferenceRoutes(router, service) {
  router.add("GET", "/api/v1/preferences", ({ userId, query }) => ({
    data: service.list(userId, query)
  }), { module: "memory" });
  router.add("POST", "/api/v1/preferences", ({ userId, body }) => ({
    status: 201,
    data: service.save(userId, body)
  }), { module: "memory" });
  router.add("PUT", "/api/v1/preferences", ({ userId, body }) => ({
    data: service.save(userId, body)
  }), { module: "memory" });
  router.add("DELETE", "/api/v1/preferences/:id", ({ userId, params }) => {
    service.delete(userId, params.id);
    return { status: 204 };
  }, { module: "memory" });
}

module.exports = { registerPreferenceRoutes };
