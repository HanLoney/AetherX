function registerXuanMoodRoutes(router, service) {
  router.add("GET", "/api/v1/xuan-mood/home", async ({ userId }) => ({
    data: await service.getHome(userId)
  }));
  router.add("POST", "/api/v1/xuan-mood/events", async ({ userId, body }) => ({
    status: 201,
    data: await service.recordEvent(userId, body)
  }));
  router.add("POST", "/api/v1/xuan-mood/refresh", async ({ userId }) => ({
    data: await service.refresh(userId)
  }));
}

module.exports = { registerXuanMoodRoutes };
