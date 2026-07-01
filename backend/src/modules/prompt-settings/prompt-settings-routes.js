function registerPromptSettingsRoutes(router, service) {
  router.add("GET", "/api/v1/prompt-settings", ({ userId }) => ({
    data: service.getBundle(userId)
  }));
  router.add("PUT", "/api/v1/prompt-settings", ({ userId, body }) => ({
    data: service.save(userId, body)
  }));
  router.add("GET", "/api/v1/prompt-settings/versions", ({ userId }) => ({
    data: service.listVersions(userId)
  }));
  router.add(
    "POST",
    "/api/v1/prompt-settings/versions/:version/restore",
    ({ userId, params }) => ({
      data: service.restore(userId, params.version)
    })
  );
}

module.exports = { registerPromptSettingsRoutes };
