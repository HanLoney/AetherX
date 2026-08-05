function registerPromptSettingsRoutes(router, service) {
  router.add("GET", "/api/v1/prompt-settings", ({ userId }) => ({
    data: service.getBundle(userId)
  }));
  router.add("PUT", "/api/v1/prompt-settings", ({ userId, body, requestId }) => {
    const result = service.saveWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  });
  router.add("GET", "/api/v1/prompt-settings/versions", ({ userId }) => ({
    data: service.listVersions(userId)
  }));
  router.add(
    "POST",
    "/api/v1/prompt-settings/versions/:version/restore",
    ({ userId, params, requestId }) => {
      const result = service.restoreWithRequestId(
        userId,
        params.version,
        requestId
      );
      return { status: result.status, data: result.result };
    }
  );
}

module.exports = { registerPromptSettingsRoutes };
