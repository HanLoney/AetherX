function registerJournalRoutes(router, service) {
  router.add("GET", "/api/v1/assistant/journals", ({ userId, query }) => ({
    data: service.list(userId, query)
  }), { module: "autonomous-journal" });
  router.add(
    "GET",
    "/api/v1/assistant/journals/material",
    ({ userId, query }) => ({ data: service.sourceMaterial(userId, query) }),
    { module: "autonomous-journal" }
  );
  router.add(
    "GET",
    "/api/v1/assistant/journals/:type/:periodKey",
    ({ userId, params }) => ({
      data: service.get(userId, params.type, params.periodKey)
    }),
    { module: "autonomous-journal" }
  );
  router.add("PUT", "/api/v1/assistant/journals", ({ userId, body }) => ({
    data: service.save(userId, body)
  }), { module: "autonomous-journal" });
  router.add("DELETE", "/api/v1/assistant/journals/:id", ({ userId, params }) => {
    service.delete(userId, params.id);
    return { status: 204 };
  }, { module: "autonomous-journal" });
}

module.exports = { registerJournalRoutes };
