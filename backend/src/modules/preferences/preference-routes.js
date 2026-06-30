function registerPreferenceRoutes(router, service) {
  router.add("GET", "/api/v1/preferences", ({ userId, query }) => ({
    data: service.list(userId, query)
  }));
  router.add("POST", "/api/v1/preferences", ({ userId, body }) => ({
    status: 201,
    data: service.save(userId, body)
  }));
  router.add("PUT", "/api/v1/preferences", ({ userId, body }) => ({
    data: service.save(userId, body)
  }));
  router.add("DELETE", "/api/v1/preferences/:id", ({ userId, params }) => {
    service.delete(userId, params.id);
    return { status: 204 };
  });
}

module.exports = { registerPreferenceRoutes };
