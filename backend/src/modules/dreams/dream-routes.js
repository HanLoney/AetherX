function registerDreamRoutes(router, service) {
  router.add("GET", "/api/v1/dreams", ({ userId, query }) => ({
    data: service.listDreams(userId, query)
  }), { module: "dreams" });
  router.add("POST", "/api/v1/dreams", ({ userId, body }) => ({
    status: 201,
    data: service.createDream(userId, body)
  }), { module: "dreams" });
  router.add("GET", "/api/v1/dreams/material", ({ userId, query }) => ({
    data: service.sourceMaterial(userId, query)
  }), { module: "dreams" });
  router.add("GET", "/api/v1/dreams/by-date/:dreamDate", ({ userId, params }) => ({
    data: service.getDreamByDate(userId, params.dreamDate)
  }), { module: "dreams" });
  router.add("GET", "/api/v1/dreams/:id", ({ userId, params }) => ({
    data: service.getDream(userId, params.id)
  }), { module: "dreams" });
  router.add("PATCH", "/api/v1/dreams/:id", ({ userId, params, body }) => ({
    data: service.updateDream(userId, params.id, body)
  }), { module: "dreams" });
  router.add("POST", "/api/v1/dreams/:id/sources", ({ userId, params, body }) => ({
    data: service.addSource(userId, params.id, body)
  }), { module: "dreams" });
  router.add("DELETE", "/api/v1/dreams/:id", ({ userId, params }) => {
    service.deleteDream(userId, params.id);
    return { status: 204 };
  }, { module: "dreams" });
}

module.exports = { registerDreamRoutes };
