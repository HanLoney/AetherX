const TIME_CONTEXT_MARKER = "[权威运行时事实：时间感知]";

function registerAiRoutes(
  router,
  configRepository,
  providerClient,
  timeAwarenessService
) {
  router.add("GET", "/api/v1/ai/config", ({ userId }) => ({
    data: configRepository.getPublic(userId)
  }));
  router.add("PUT", "/api/v1/ai/config", ({ userId, body }) => ({
    data: configRepository.save(userId, body)
  }));
  router.add("GET", "/api/v1/ai/image-config", ({ userId }) => ({
    data: configRepository.getImagePublic(userId)
  }));
  router.add("PUT", "/api/v1/ai/image-config", ({ userId, body }) => ({
    data: configRepository.saveImage(userId, body)
  }));
  router.add("POST", "/api/v1/ai/chat", async ({ userId, body }) => {
    const stored = configRepository.getCredentials(userId);
    const config = {
      ...stored,
      ...(body.baseUrl ? { baseUrl: String(body.baseUrl).replace(/\/+$/, "") } : {}),
      ...(body.model ? { model: String(body.model) } : {}),
      ...(body.apiKey ? { apiKey: String(body.apiKey) } : {})
    };
    const runtime = runtimeTimeContext(
      userId,
      body.runtime,
      timeAwarenessService,
      body.messages
    );
    const payload = runtime
      ? {
          ...body,
          messages: injectRuntimeTime(body.messages, runtime.context)
        }
      : body;
    const result = await providerClient.chat(config, payload);
    if (runtime) {
      const latest = runtimeTimeContext(
        userId,
        body.runtime,
        timeAwarenessService,
        body.messages
      );
      normalizeCurrentTimeClaims(result, latest.localTime);
    }
    return { data: result };
  });
  router.add("POST", "/api/v1/ai/image-generations", async ({ userId, body }) => {
    const stored = configRepository.getImageCredentials(userId);
    const config = {
      ...stored,
      ...(body.baseUrl ? { baseUrl: String(body.baseUrl).replace(/\/+$/, "") } : {}),
      ...(body.model ? { model: String(body.model) } : {}),
      ...(body.apiKey ? { apiKey: String(body.apiKey) } : {})
    };
    const result = await providerClient.image(config, body);
    return { data: result };
  });
}

function runtimeTimeContext(userId, input, service, messages) {
  if (!service || input?.timeAwareness !== true) return null;
  return service.getContext(userId, {
    timeZone: input.timeZone,
    locale: input.locale,
    currentUserMessage: latestUserMessage(messages)
  });
}

function latestUserMessage(messages) {
  if (!Array.isArray(messages)) return "";
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return String(messages[index].content || "");
    }
  }
  return "";
}

function injectRuntimeTime(messages, context) {
  const result = Array.isArray(messages)
    ? messages.filter(
        (message) =>
          !(
            message?.role === "system" &&
            String(message.content || "").includes(TIME_CONTEXT_MARKER)
          )
      )
    : [];
  const runtimeMessage = { role: "system", content: context };
  const firstSystemIndex = result.findIndex(
    (message) => message?.role === "system"
  );
  if (firstSystemIndex >= 0) {
    result[firstSystemIndex] = {
      ...result[firstSystemIndex],
      content: `${context}\n\n${String(result[firstSystemIndex].content || "")}`
    };
    return result;
  }
  result.unshift(runtimeMessage);
  return result;
}

function normalizeCurrentTimeClaims(result, localTime) {
  const message = result?.data?.choices?.[0]?.message;
  if (!message || typeof message.content !== "string") return result;
  message.content = message.content.replace(
    /((?:现在|当前|此刻)[^。\n！？\d]{0,24})(\d{1,2}:\d{2})/g,
    `$1${localTime}`
  );
  return result;
}

module.exports = {
  injectRuntimeTime,
  normalizeCurrentTimeClaims,
  registerAiRoutes
};
