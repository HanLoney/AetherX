function registerTimeAwarenessRoutes(router, service) {
  router.add("POST", "/api/v1/time-awareness/context", ({ userId, body }) => ({
    data: service.getContext(userId, body)
  }));
}

module.exports = { registerTimeAwarenessRoutes };
