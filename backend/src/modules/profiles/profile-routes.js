function registerProfileRoutes(router, service) {
  router.add("GET", "/api/v1/profile", ({ userId }) => ({
    data: service.get(userId)
  }));
  router.add("PUT", "/api/v1/profile", ({ userId, body, requestId }) => {
    const result = service.saveWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  });
  router.add("PATCH", "/api/v1/profile", ({ userId, body, requestId }) => {
    const result = service.patchWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  });
}

module.exports = { registerProfileRoutes };
