function registerAgentRoutes(router, service) {
  router.add("POST", "/api/v1/agent/chat", async ({ userId, body }) => ({
    data: await service.chat(userId, body)
  }));
  router.add(
    "POST",
    "/api/v1/agent/runs/:id/approve",
    async ({ userId, params, body }) => ({
      data: await service.approve(userId, params.id, body.approved === true)
    })
  );
}

module.exports = { registerAgentRoutes };
