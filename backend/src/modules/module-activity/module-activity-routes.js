function registerModuleActivityRoutes(router, service) {
  router.add("GET", "/api/v1/modules/activity", ({ userId, query }) => ({
    data: service.list(userId, query)
  }));
  router.add("POST", "/api/v1/modules/activity", ({ userId, body }) => ({
    data: service.record(userId, body)
  }));
}

module.exports = { registerModuleActivityRoutes };
