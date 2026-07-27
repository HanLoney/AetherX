function registerAlbumRoutes(router, service) {
  router.add("GET", "/api/v1/album/moments", ({ userId, query }) => ({
    data: service.listMoments(userId, query)
  }), { module: "anniversary-album" });
  router.add("POST", "/api/v1/album/moments", ({ userId, body }) => ({
    status: 201,
    data: service.createMoment(userId, body)
  }), { module: "anniversary-album" });
  router.add("GET", "/api/v1/album/moments/:id", ({ userId, params }) => ({
    data: service.getMoment(userId, params.id)
  }), { module: "anniversary-album" });
  router.add("PATCH", "/api/v1/album/moments/:id", ({ userId, params, body }) => ({
    data: service.updateMoment(userId, params.id, body)
  }), { module: "anniversary-album" });
  router.add("POST", "/api/v1/album/moments/:id/hide", ({ userId, params }) => ({
    data: service.hideMoment(userId, params.id)
  }), { module: "anniversary-album" });
  router.add(
    "POST",
    "/api/v1/album/moments/:id/sources",
    ({ userId, params, body }) => ({
      data: service.addSource(userId, params.id, body)
    }),
    { module: "anniversary-album" }
  );
  router.add("DELETE", "/api/v1/album/moments/:id", ({ userId, params }) => {
    service.deleteMoment(userId, params.id);
    return { status: 204 };
  }, { module: "anniversary-album" });
  router.add("GET", "/api/v1/album/source-candidates", ({ userId, query }) => ({
    data: service.listSourceCandidates(userId, query)
  }), { module: "anniversary-album" });
}

module.exports = { registerAlbumRoutes };
