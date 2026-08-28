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
  router.add("PATCH", "/api/v1/wallet/accounts/:id/transactions/:transactionId", ({
    userId,
    params,
    body,
    requestId
  }) => {
    const result = service.updateTransactionWithRequestId(
      userId,
      params.id,
      params.transactionId,
      body,
      requestId
    );
    return { status: result.status, data: result.result };
  }, { module: "wallet" });
  router.add("POST", "/api/v1/wallet/accounts", ({ userId, body, requestId }) => {
    const result = service.createWithRequestId(
      userId,
      body,
      requestId,
      { source: "manual" }
    );
    return { status: result.status, data: result.result };
  }, { module: "wallet" });
  router.add("PATCH", "/api/v1/wallet/accounts/:id", ({
    userId,
    params,
    body,
    requestId
  }) => {
    const result = service.updateWithRequestId(
      userId,
      params.id,
      body,
      requestId,
      { source: "manual" }
    );
    return { status: result.status, data: result.result };
  }, { module: "wallet" });
  router.add("POST", "/api/v1/wallet/accounts/:id/adjust", ({
    userId,
    params,
    body,
    requestId
  }) => {
    const result = service.adjustWithRequestId(
      userId,
      params.id,
      body,
      requestId,
      { source: "manual" }
    );
    return { status: result.status, data: result.result };
  }, { module: "wallet" });
  router.add("DELETE", "/api/v1/wallet/accounts/:id", ({ userId, params, requestId }) => {
    const result = service.deleteWithRequestId(userId, params.id, requestId);
    if (result.status !== 204) return { status: result.status, data: result.result };
    return { status: 204 };
  }, { module: "wallet" });
}

module.exports = { registerWalletRoutes };
