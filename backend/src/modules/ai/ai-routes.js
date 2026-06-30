function registerAiRoutes(router, configRepository, providerClient) {
  router.add("GET", "/api/v1/ai/config", ({ userId }) => ({
    data: configRepository.getPublic(userId)
  }));
  router.add("PUT", "/api/v1/ai/config", ({ userId, body }) => ({
    data: configRepository.save(userId, body)
  }));
  router.add("POST", "/api/v1/ai/chat", async ({ userId, body }) => {
    const stored = configRepository.getCredentials(userId);
    const config = {
      ...stored,
      ...(body.baseUrl ? { baseUrl: String(body.baseUrl).replace(/\/+$/, "") } : {}),
      ...(body.model ? { model: String(body.model) } : {}),
      ...(body.apiKey ? { apiKey: String(body.apiKey) } : {})
    };
    return { data: await providerClient.chat(config, body) };
  });
}

module.exports = { registerAiRoutes };
