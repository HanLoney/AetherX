function registerWalletRoutes(router, service) {
  router.add("GET", "/api/v1/wallet", ({ userId }) => ({
    data: service.summary(userId)
  }), { module: "wallet" });
  router.add("GET", "/api/v1/wallet/accounts/:id", ({ userId, params }) => ({
    data: service.get(userId, params.id)
  }), { module: "wallet" });
  router.add("GET", "/api/v1/wallet/accounts/:id/transactions", ({ userId, params, query }) => ({
    data: service.listTransactions(userId, params.id, query)
  }), { module: "wallet" });
  router.add("POST", "/api/v1/wallet/accounts", ({ userId, body }) => ({
    status: 201,
    data: service.create(userId, body, { source: "manual" })
  }), { module: "wallet" });
  router.add("PATCH", "/api/v1/wallet/accounts/:id", ({ userId, params, body }) => ({
    data: service.update(userId, params.id, body, { source: "manual" })
  }), { module: "wallet" });
  router.add("POST", "/api/v1/wallet/accounts/:id/adjust", ({ userId, params, body }) => ({
    data: service.adjust(userId, params.id, body, { source: "manual" })
  }), { module: "wallet" });
  router.add("DELETE", "/api/v1/wallet/accounts/:id", ({ userId, params }) => {
    service.delete(userId, params.id);
    return { status: 204 };
  }, { module: "wallet" });
}

module.exports = { registerWalletRoutes };
