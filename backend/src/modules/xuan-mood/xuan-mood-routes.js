function registerXuanMoodRoutes(router, service) {
  router.add("GET", "/api/v1/xuan-mood/home", async ({ userId }) => ({
    data: await service.getHome(userId)
  }), { module: "xuan-mood" });
  router.add("POST", "/api/v1/xuan-mood/events", async ({ userId, body }) => ({
    status: 201,
    data: await service.recordEvent(userId, body)
  }), { module: "xuan-mood" });
  router.add("POST", "/api/v1/xuan-mood/refresh", async ({ userId }) => ({
    data: await service.refresh(userId)
  }), { module: "xuan-mood" });
}

module.exports = { registerXuanMoodRoutes };
