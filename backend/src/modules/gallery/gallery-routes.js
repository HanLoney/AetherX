function registerGalleryRoutes(router, service) {
  router.add("GET", "/api/v1/assistant/gallery/summary", ({ userId, query }) => ({
    data: service.summary(userId, query)
  }));
  router.add("GET", "/api/v1/assistant/gallery/page", ({ userId, query }) => ({
    data: service.page(userId, query)
  }));
  router.add("GET", "/api/v1/assistant/gallery", ({ userId, query }) => ({
    data: service.list(userId, query)
  }));
}

module.exports = { registerGalleryRoutes };
