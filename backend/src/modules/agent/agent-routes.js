function registerAgentRoutes(router, service, permissionRepository) {
  router.add("GET", "/api/v1/agent/permissions", ({ userId }) => ({
    data: permissionRepository.get(userId)
  }));
  router.add("PUT", "/api/v1/agent/permissions", ({ userId, body }) => ({
    data: permissionRepository.set(userId, body.autoApproveWrites === true)
  }));
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
