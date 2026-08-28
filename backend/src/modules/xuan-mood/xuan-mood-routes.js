function registerXuanMoodRoutes(router, service) {
  router.add("GET", "/api/v1/xuan-mood/home", async ({ userId }) => ({
    data: await service.getHome(userId)
  }), { module: "xuan-mood" });
  router.add("POST", "/api/v1/xuan-mood/events", async ({ userId, body, requestId }) => {
    const result = await service.recordEventWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  }, { module: "xuan-mood" });
  router.add("POST", "/api/v1/xuan-mood/refresh", async ({ userId, requestId }) => {
    const result = await service.refreshWithRequestId(userId, requestId);
    return { status: result.status, data: result.result };
  }, { module: "xuan-mood" });
}

module.exports = { registerXuanMoodRoutes };
