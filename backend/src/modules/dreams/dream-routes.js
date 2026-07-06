function registerDreamRoutes(router, service) {
  router.add("GET", "/api/v1/dreams", ({ userId, query }) => ({
    data: service.listDreams(userId, query)
  }));
  router.add("POST", "/api/v1/dreams", ({ userId, body }) => ({
    status: 201,
    data: service.createDream(userId, body)
  }));
  router.add("GET", "/api/v1/dreams/material", ({ userId, query }) => ({
    data: service.sourceMaterial(userId, query)
  }));
  router.add("GET", "/api/v1/dreams/by-date/:dreamDate", ({ userId, params }) => ({
    data: service.getDreamByDate(userId, params.dreamDate)
  }));
  router.add("GET", "/api/v1/dreams/:id", ({ userId, params }) => ({
    data: service.getDream(userId, params.id)
  }));
  router.add("PATCH", "/api/v1/dreams/:id", ({ userId, params, body }) => ({
    data: service.updateDream(userId, params.id, body)
  }));
  router.add("POST", "/api/v1/dreams/:id/sources", ({ userId, params, body }) => ({
    data: service.addSource(userId, params.id, body)
  }));
  router.add("DELETE", "/api/v1/dreams/:id", ({ userId, params }) => {
    service.deleteDream(userId, params.id);
    return { status: 204 };
  });
}

module.exports = { registerDreamRoutes };
