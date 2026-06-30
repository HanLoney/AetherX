function registerConversationRoutes(router, service) {
  router.add("GET", "/api/v1/conversations", ({ userId }) => ({
    data: service.list(userId)
  }));
  router.add("POST", "/api/v1/conversations", ({ userId, body }) => ({
    status: 201,
    data: service.create(userId, body)
  }));
  router.add("GET", "/api/v1/conversations/:id", ({ userId, params }) => ({
    data: service.get(userId, params.id)
  }));
  router.add(
    "PUT",
    "/api/v1/conversations/:id/messages",
    ({ userId, params, body }) => ({
      data: service.saveMessages(userId, params.id, body)
    })
  );
  router.add("DELETE", "/api/v1/conversations/:id", ({ userId, params }) => {
    service.delete(userId, params.id);
    return { status: 204 };
  });
}

module.exports = { registerConversationRoutes };
