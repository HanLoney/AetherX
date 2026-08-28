function registerModuleSettingsRoutes(router, manager) {
  router.add("GET", "/api/v1/modules", ({ userId }) => ({
    data: manager.snapshot(userId)
  }));
  router.add(
    "PATCH",
    "/api/v1/modules/:id",
    ({ userId, params, body, requestId }) => {
      const result = manager.setEnabledWithRequestId(
        userId,
        params.id,
        body.enabled === true,
        requestId
      );
      return { status: result.status, data: result.result };
    }
  );
}

module.exports = { registerModuleSettingsRoutes };
