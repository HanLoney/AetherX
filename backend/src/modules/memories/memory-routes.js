function registerMemoryRoutes(
  router,
  service,
  intelligenceService,
  consolidationService
) {
  router.add("POST", "/api/v1/memories/recall", ({ userId, body }) => ({
    data: intelligenceService.recall(userId, body)
  }));
  router.add("POST", "/api/v1/memories/extract", async ({ userId, body }) => ({
    data: await intelligenceService.extract(userId, body)
  }));
  router.add("POST", "/api/v1/memories/consolidate", ({ userId }) => ({
    data: consolidationService.consolidateExisting(userId)
  }));
  router.add("GET", "/api/v1/memories", ({ userId, query }) => ({
    data: service.list(userId, query)
  }));
  router.add("POST", "/api/v1/memories", ({ userId, body }) => ({
    status: 201,
    data: consolidationService.consolidateCandidate(
      userId,
      body,
      {
        evidence: body.sourceExcerpt || body.content,
        conversationId: body.conversationId || ""
      }
    ).memory
  }));
  router.add("GET", "/api/v1/memories/:id", ({ userId, params }) => ({
    data: service.get(userId, params.id)
  }));
  router.add("PATCH", "/api/v1/memories/:id", ({ userId, params, body }) => ({
    data: service.update(userId, params.id, body)
  }));
  router.add("POST", "/api/v1/memories/:id/confirm", ({ userId, params }) => ({
    data: service.confirm(userId, params.id)
  }));
  router.add("DELETE", "/api/v1/memories/:id", ({ userId, params }) => {
    service.delete(userId, params.id);
    return { status: 204 };
  });
}

module.exports = { registerMemoryRoutes };
