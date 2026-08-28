function registerConversationRoutes(router, service) {
  router.add("GET", "/api/v1/conversations", ({ userId }) => ({
    data: service.list(userId)
  }));
  router.add("GET", "/api/v1/conversations/page", ({ userId, query }) => ({
    data: service.page(userId, query)
  }));
  router.add("POST", "/api/v1/conversations", ({ userId, body, requestId }) => {
    const result = service.createWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  });
  router.add("GET", "/api/v1/conversations/:id", ({ userId, params }) => ({
    data: service.get(userId, params.id)
  }));
  router.add(
    "PUT",
    "/api/v1/conversations/:id/messages",
    ({ userId, params, body, requestId }) => {
      const result = service.saveMessagesWithRequestId(
        userId,
        params.id,
        body,
        requestId
      );
      return { status: result.status, data: result.result };
    }
  );
  router.add("DELETE", "/api/v1/conversations/:id", ({ userId, params, requestId }) => {
    const result = service.deleteWithRequestId(userId, params.id, requestId);
    if (result.status !== 204) return { status: result.status, data: result.result };
    return { status: 204 };
  });
}

module.exports = { registerConversationRoutes };
