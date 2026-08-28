function registerAssistantMemoryRoutes(router, service) {
  router.add("GET", "/api/v1/assistant/profile", ({ userId }) => ({
    data: service.getProfile(userId)
  }));
  router.add("PATCH", "/api/v1/assistant/profile", ({ userId, body, requestId }) => {
    const result = service.saveProfileWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  });
  router.add(
    "GET",
    "/api/v1/assistant/personality-events",
    ({ userId, query }) => ({ data: service.listEvents(userId, query) }),
    { module: "memory" }
  );
  router.add(
    "POST",
    "/api/v1/assistant/personality-events",
    ({ userId, body, requestId }) => {
      const result = service.recordEventWithRequestId(userId, body, requestId);
      return { status: result.status, data: result.result };
    },
    { module: "memory" }
  );
  router.add(
    "POST",
    "/api/v1/assistant/personality-events/:id/confirm",
    ({ userId, params, requestId }) => {
      const result = service.confirmEventWithRequestId(userId, params.id, requestId);
      return { status: result.status, data: result.result };
    },
    { module: "memory" }
  );
  router.add(
    "DELETE",
    "/api/v1/assistant/personality-events/:id",
    ({ userId, params, requestId }) => {
      const result = service.deleteEventWithRequestId(userId, params.id, requestId);
      if (result.status !== 204) return { status: result.status, data: result.result };
      return { status: 204 };
    },
    { module: "memory" }
  );
  router.add(
    "GET",
    "/api/v1/shared-memories",
    ({ userId, query }) => ({ data: service.listSharedMemories(userId, query) }),
    { module: "memory" }
  );
  router.add(
    "POST",
    "/api/v1/shared-memories",
    ({ userId, body, requestId }) => {
      const result = service.createSharedMemoryWithRequestId(userId, body, requestId);
      return { status: result.status, data: result.result };
    },
    { module: "memory" }
  );
  router.add(
    "POST",
    "/api/v1/shared-memories/:id/confirm",
    ({ userId, params, requestId }) => {
      const result = service.confirmSharedMemoryWithRequestId(userId, params.id, requestId);
      return { status: result.status, data: result.result };
    },
    { module: "memory" }
  );
  router.add(
    "DELETE",
    "/api/v1/shared-memories/:id",
    ({ userId, params, requestId }) => {
      const result = service.deleteSharedMemoryWithRequestId(userId, params.id, requestId);
      if (result.status !== 204) return { status: result.status, data: result.result };
      return { status: 204 };
    },
    { module: "memory" }
  );
}

module.exports = { registerAssistantMemoryRoutes };
