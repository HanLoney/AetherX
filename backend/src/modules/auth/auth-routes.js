function registerAuthRoutes(router, service) {
  router.add(
    "GET",
    "/api/v1/auth/config",
    () => ({ data: service.getRegistrationConfig() }),
    { public: true }
  );
  router.add(
    "POST",
    "/api/v1/auth/register",
    async ({ body }) => ({ data: await service.register(body) }),
    { public: true }
  );
  router.add(
    "POST",
    "/api/v1/auth/login",
    async ({ body, request }) => ({
      data: await service.login(body, request.socket.remoteAddress)
    }),
    { public: true }
  );
  router.add("GET", "/api/v1/auth/session", ({ auth }) => ({
    data: { user: auth.user }
  }));
  router.add("POST", "/api/v1/auth/logout", ({ auth }) => {
    service.logout(auth);
    return { status: 204 };
  });
}

module.exports = { registerAuthRoutes };
