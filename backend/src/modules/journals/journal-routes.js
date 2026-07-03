function registerJournalRoutes(router, service) {
  router.add("GET", "/api/v1/assistant/journals", ({ userId, query }) => ({
    data: service.list(userId, query)
  }));
  router.add(
    "GET",
    "/api/v1/assistant/journals/material",
    ({ userId, query }) => ({ data: service.sourceMaterial(userId, query) })
  );
  router.add(
    "GET",
    "/api/v1/assistant/journals/:type/:periodKey",
    ({ userId, params }) => ({
      data: service.get(userId, params.type, params.periodKey)
    })
  );
  router.add("PUT", "/api/v1/assistant/journals", ({ userId, body }) => ({
    data: service.save(userId, body)
  }));
  router.add("DELETE", "/api/v1/assistant/journals/:id", ({ userId, params }) => {
    service.delete(userId, params.id);
    return { status: 204 };
  });
}

module.exports = { registerJournalRoutes };
