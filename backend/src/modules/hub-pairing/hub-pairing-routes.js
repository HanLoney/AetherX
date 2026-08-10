function registerHubPairingRoutes(
  router,
  service,
  importService,
  integrityService,
  bootstrapCoordinator
) {
  router.add("POST", "/api/v1/hub-pairing/import", ({ userId, body }) => ({
    data: importService.import(userId, body)
  }));
  router.add("POST", "/api/v1/hub-pairing/sessions", ({ userId, body }) => ({
    status: 201,
    data: service.create(userId, body)
  }));
  router.add(
    "POST",
    "/api/v1/hub-pairing/bootstrap/run",
    async ({ userId }) => ({
      data: await bootstrapCoordinator.run(userId)
    })
  );
  router.add(
    "POST",
    "/api/v1/hub-pairing/bootstrap/:id/restore",
    async ({ userId, params }) => ({
      data: await integrityService.restoreStaging(userId, params.id)
    })
  );
  router.add(
    "GET",
    "/api/v1/hub-pairing/bootstrap/:id/status",
    ({ userId, params }) => ({
      data: integrityService.getStagingStatus(userId, params.id)
    }),
    { parseBody: false }
  );
  router.add(
    "POST",
    "/api/v1/hub-pairing/bootstrap/:id/proof",
    async ({ userId, params }) => ({
      data: await integrityService.createCompletionProof(userId, params.id)
    })
  );
  router.add(
    "POST",
    "/api/v1/hub-pairing/bootstrap/:id/finalize",
    async ({ userId, params, body }) => ({
      data: await integrityService.finalizeLocalStandby(userId, params.id, body)
    })
  );
  router.add(
    "POST",
    "/api/v1/hub-pairing/sessions/:id/resolve",
    ({ params, body }) => ({ data: service.resolve(params.id, body) }),
    { public: true }
  );
  router.add(
    "POST",
    "/api/v1/hub-pairing/sessions/:id/claim",
    ({ params, body }) => ({ data: service.claim(params.id, body) }),
    { public: true }
  );
  router.add("GET", "/api/v1/hub-pairing/sessions/:id", ({ userId, params }) => ({
    data: service.get(userId, params.id)
  }));
  router.add(
    "POST",
    "/api/v1/hub-pairing/sessions/:id/approve",
    ({ userId, params }) => ({ data: service.approve(userId, params.id) })
  );
  router.add(
    "POST",
    "/api/v1/hub-pairing/sessions/:id/redeem",
    ({ params, body }) => ({ data: service.redeem(params.id, body) }),
    { public: true }
  );
}

module.exports = { registerHubPairingRoutes };
