function registerGalleryRoutes(router, service) {
  router.add("GET", "/api/v1/assistant/gallery", ({ userId, query }) => ({
    data: service.list(userId, query)
  }));
}

module.exports = { registerGalleryRoutes };
