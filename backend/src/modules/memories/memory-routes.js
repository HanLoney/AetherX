function registerMemoryRoutes(
  router,
  service,
  intelligenceService,
  consolidationService
) {
  router.add("POST", "/api/v1/memories/recall", ({ userId, body }) => ({
    data: intelligenceService.recall(userId, body)
  }), { module: "memory" });
  router.add("POST", "/api/v1/memories/extract", async ({ userId, body }) => ({
    data: await intelligenceService.extract(userId, body)
  }), { module: "memory" });
  router.add("POST", "/api/v1/memories/consolidate", ({ userId }) => ({
    data: consolidationService.consolidateExisting(userId)
  }), { module: "memory" });
  router.add("GET", "/api/v1/memories", ({ userId, query }) => ({
    data: service.list(userId, query)
  }), { module: "memory" });
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
  }), { module: "memory" });
  router.add("GET", "/api/v1/memories/:id", ({ userId, params }) => ({
    data: service.get(userId, params.id)
  }), { module: "memory" });
  router.add("PATCH", "/api/v1/memories/:id", ({ userId, params, body, requestId }) => {
    const result = service.updateWithRequestId(userId, params.id, body, requestId);
    return { status: result.status, data: result.result };
  }, { module: "memory" });
  router.add("POST", "/api/v1/memories/:id/confirm", ({ userId, params, requestId }) => {
    const result = service.confirmWithRequestId(userId, params.id, requestId);
    return { status: result.status, data: result.result };
  }, { module: "memory" });
  router.add("DELETE", "/api/v1/memories/:id", ({ userId, params, requestId }) => {
    const result = service.deleteWithRequestId(userId, params.id, requestId);
    if (result.status !== 204) return { status: result.status, data: result.result };
    return { status: 204 };
  }, { module: "memory" });
}

module.exports = { registerMemoryRoutes };
