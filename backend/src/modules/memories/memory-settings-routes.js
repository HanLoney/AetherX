function registerMemorySettingsRoutes(router, service) {
  router.add("GET", "/api/v1/memories/settings", ({ userId }) => ({
    data: service.get(userId)
  }));
  router.add("PUT", "/api/v1/memories/settings", ({ userId, body }) => ({
    data: service.save(userId, body)
  }));
}

module.exports = { registerMemorySettingsRoutes };
