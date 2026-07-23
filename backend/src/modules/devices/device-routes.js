function registerDeviceRoutes(router, service) {
  router.add("POST", "/api/v1/pairing/sessions", ({ userId, body }) => ({
    data: service.createPairingSession(userId, body)
  }));
  router.add(
    "POST",
    "/api/v1/pairing/sessions/:id/claim",
    ({ params, body }) => ({ data: service.claimPairingSession(params.id, body) }),
    { public: true }
  );
  router.add("GET", "/api/v1/pairing/sessions/:id", ({ userId, params }) => ({
    data: service.getPairingSession(userId, params.id)
  }));
  router.add(
    "POST",
    "/api/v1/pairing/sessions/:id/approve",
    ({ userId, params }) => ({
      data: service.approvePairingSession(userId, params.id)
    })
  );
  router.add(
    "POST",
    "/api/v1/pairing/sessions/:id/redeem",
    ({ params, body }) => ({ data: service.redeemPairingSession(params.id, body) }),
    { public: true }
  );
  router.add("GET", "/api/v1/devices", ({ userId }) => ({
    data: { devices: service.listDevices(userId) }
  }));
  router.add("POST", "/api/v1/devices/heartbeat", ({ userId, auth, body }) => ({
    data: service.recordHeartbeat(userId, auth, body)
  }));
  router.add("GET", "/api/v1/devices/health", ({ userId }) => ({
    data: { clients: service.listMobileHealth(userId) }
  }));
  router.add("DELETE", "/api/v1/devices/:id", ({ userId, params }) => {
    service.revokeDevice(userId, params.id);
    return { status: 204 };
  });
}

module.exports = { registerDeviceRoutes };
