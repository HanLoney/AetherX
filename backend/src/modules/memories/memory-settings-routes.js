function registerMemorySettingsRoutes(router, service) {
  router.add("GET", "/api/v1/memories/settings", ({ userId }) => ({
    data: service.get(userId)
  }), { module: "memory" });
  router.add("PUT", "/api/v1/memories/settings", ({ userId, body, requestId }) => {
    const result = service.saveWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  }, { module: "memory" });
}

module.exports = { registerMemorySettingsRoutes };
