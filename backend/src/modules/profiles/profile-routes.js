function registerProfileRoutes(router, service) {
  router.add("GET", "/api/v1/profile", ({ userId }) => ({
    data: service.get(userId)
  }));
  router.add("PUT", "/api/v1/profile", ({ userId, body }) => ({
    data: service.save(userId, body)
  }));
}

module.exports = { registerProfileRoutes };
