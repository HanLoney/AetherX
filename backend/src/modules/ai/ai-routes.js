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
    if (runtime && isDirectTimeRequest(body.messages)) {
      return { data: directTimeCompletion(runtime) };
    }
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

function isDirectTimeRequest(messages) {
  if (!Array.isArray(messages)) return false;
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      userIndex = index;
      break;
    }
  }
  if (userIndex < 0) return false;
  const text = String(messages[userIndex].content || "").trim();
  if (
    text.length <= 50 &&
    /(几点了?|现在.{0,6}(?:时间|几点)|当前.{0,6}(?:时间|几点)|此刻.{0,6}(?:时间|几点)|今天.{0,6}(?:几号|日期|星期|周几))/.test(
      text
    )
  ) {
    return true;
  }
  const previousAssistant = [...messages.slice(0, userIndex)]
    .reverse()
    .find((message) => message?.role === "assistant");
  if (!hasCurrentTimeClaim(previousAssistant?.content)) return false;
  return (
    text.length <= 20 &&
    (/^(?:真的|确定|你确定|是|不是|刚才|现在)?\s*\d{1,2}(?::\d{1,2})?\s*(?:吗|呢|吧|？|\?)?$/.test(
      text
    ) ||
      /^(?:真的|确定|你确定|对吗|没错吗|不是吧|错了)[？?吗呢吧]*$/.test(
        text
      ))
  );
}

function hasCurrentTimeClaim(content) {
  return /(?:现在|当前|此刻)[^。\n！？\d]{0,24}\d{1,2}:\d{2}/.test(
    String(content || "")
  );
}

function directTimeCompletion(runtime) {
  return {
    ok: true,
    status: 200,
    data: {
      choices: [{
        finish_reason: "stop",
        message: {
          role: "assistant",
          content: `现在是 **${runtime.localTime}**，以系统刚刚读取的 ${runtime.timeZone} 时间为准。`
        }
      }]
    }
  };
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
  isDirectTimeRequest,
  normalizeCurrentTimeClaims,
  registerAiRoutes
};
