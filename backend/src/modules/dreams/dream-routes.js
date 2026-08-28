function registerDreamRoutes(router, service) {
  router.add("GET", "/api/v1/dreams", ({ userId, query }) => ({
    data: service.listDreams(userId, query)
  }), { module: "dreams" });
  router.add("POST", "/api/v1/dreams", ({ userId, body, requestId }) => {
    const result = service.createDreamWithRequestId(userId, body, requestId);
    return { status: result.status, data: result.result };
  }, { module: "dreams" });
  router.add("GET", "/api/v1/dreams/material", ({ userId, query }) => ({
    data: service.sourceMaterial(userId, query)
  }), { module: "dreams" });
  router.add("GET", "/api/v1/dreams/by-date/:dreamDate", ({ userId, params }) => ({
    data: service.getDreamByDate(userId, params.dreamDate)
  }), { module: "dreams" });
  router.add("GET", "/api/v1/dreams/:id", ({ userId, params }) => ({
    data: service.getDream(userId, params.id)
  }), { module: "dreams" });
  router.add("PATCH", "/api/v1/dreams/:id", ({ userId, params, body, requestId }) => {
    const result = service.updateDreamWithRequestId(
      userId,
      params.id,
      body,
      requestId
    );
    return { status: result.status, data: result.result };
  }, { module: "dreams" });
  router.add("POST", "/api/v1/dreams/:id/sources", ({ userId, params, body, requestId }) => {
    const result = service.addSourceWithRequestId(
      userId,
      params.id,
      body,
      requestId
    );
    return { status: result.status, data: result.result };
  }, { module: "dreams" });
  router.add("DELETE", "/api/v1/dreams/:id", ({ userId, params, requestId }) => {
    const result = service.deleteDreamWithRequestId(userId, params.id, requestId);
    if (result.status !== 204) return { status: result.status, data: result.result };
    return { status: 204 };
  }, { module: "dreams" });
}

module.exports = { registerDreamRoutes };
