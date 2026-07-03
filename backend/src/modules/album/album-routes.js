function registerAlbumRoutes(router, service) {
  router.add("GET", "/api/v1/album/moments", ({ userId, query }) => ({
    data: service.listMoments(userId, query)
  }));
  router.add("POST", "/api/v1/album/moments", ({ userId, body }) => ({
    status: 201,
    data: service.createMoment(userId, body)
  }));
  router.add("GET", "/api/v1/album/moments/:id", ({ userId, params }) => ({
    data: service.getMoment(userId, params.id)
  }));
  router.add("PATCH", "/api/v1/album/moments/:id", ({ userId, params, body }) => ({
    data: service.updateMoment(userId, params.id, body)
  }));
  router.add("POST", "/api/v1/album/moments/:id/hide", ({ userId, params }) => ({
    data: service.hideMoment(userId, params.id)
  }));
  router.add(
    "POST",
    "/api/v1/album/moments/:id/sources",
    ({ userId, params, body }) => ({
      data: service.addSource(userId, params.id, body)
    })
  );
  router.add("DELETE", "/api/v1/album/moments/:id", ({ userId, params }) => {
    service.deleteMoment(userId, params.id);
    return { status: 204 };
  });
  router.add("GET", "/api/v1/album/source-candidates", ({ userId, query }) => ({
    data: service.listSourceCandidates(userId, query)
  }));
}

module.exports = { registerAlbumRoutes };
