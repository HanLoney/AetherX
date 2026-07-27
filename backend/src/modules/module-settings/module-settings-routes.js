function registerModuleSettingsRoutes(router, manager) {
  router.add("GET", "/api/v1/modules", ({ userId }) => ({
    data: manager.snapshot(userId)
  }));
  router.add("PATCH", "/api/v1/modules/:id", ({ userId, params, body }) => ({
    data: manager.setEnabled(userId, params.id, body.enabled === true)
  }));
}

module.exports = { registerModuleSettingsRoutes };
