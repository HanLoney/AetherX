function registerAssistantMemoryRoutes(router, service) {
  router.add("GET", "/api/v1/assistant/profile", ({ userId }) => ({
    data: service.getProfile(userId)
  }));
  router.add("PATCH", "/api/v1/assistant/profile", ({ userId, body }) => ({
    data: service.saveProfile(userId, body)
  }));
  router.add(
    "GET",
    "/api/v1/assistant/personality-events",
    ({ userId, query }) => ({ data: service.listEvents(userId, query) }),
    { module: "memory" }
  );
  router.add(
    "POST",
    "/api/v1/assistant/personality-events",
    ({ userId, body }) => ({
      status: 201,
      data: service.recordEvent(userId, body)
    }),
    { module: "memory" }
  );
  router.add(
    "POST",
    "/api/v1/assistant/personality-events/:id/confirm",
    ({ userId, params }) => ({ data: service.confirmEvent(userId, params.id) }),
    { module: "memory" }
  );
  router.add(
    "DELETE",
    "/api/v1/assistant/personality-events/:id",
    ({ userId, params }) => {
      service.deleteEvent(userId, params.id);
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
    ({ userId, body }) => ({
      status: 201,
      data: service.createSharedMemory(userId, body)
    }),
    { module: "memory" }
  );
  router.add(
    "POST",
    "/api/v1/shared-memories/:id/confirm",
    ({ userId, params }) => ({
      data: service.confirmSharedMemory(userId, params.id)
    }),
    { module: "memory" }
  );
  router.add(
    "DELETE",
    "/api/v1/shared-memories/:id",
    ({ userId, params }) => {
      service.deleteSharedMemory(userId, params.id);
      return { status: 204 };
    },
    { module: "memory" }
  );
}

module.exports = { registerAssistantMemoryRoutes };
