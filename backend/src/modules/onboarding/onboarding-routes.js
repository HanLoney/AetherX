function registerOnboardingRoutes(router, service) {
  router.add("GET", "/api/v1/onboarding", ({ userId }) => ({
    data: service.get(userId)
  }));
  router.add("PATCH", "/api/v1/onboarding", ({ userId, body, requestId }) => {
    const result = service.saveWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  });
}

module.exports = { registerOnboardingRoutes };
