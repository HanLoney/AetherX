const { randomUUID } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");

function registerClusterRoutes(
  router,
  service,
  switchPreflightService = null,
  switchStateMachineService = null,
  switchRecoveryService = null,
  clientSessionHandoffService = null,
  syncEventBroker = null
) {
  router.add("GET", "/api/v1/cluster/status", ({ userId }) => ({
    data: service.status(userId)
  }));
  router.add("GET", "/api/v1/cluster/mobile-hubs", ({ userId }) => ({
    data: { hubs: service.mobileHubs(userId) }
  }));
  if (syncEventBroker) {
    router.add(
      "POST",
      "/api/v1/cluster/mobile-hubs/:id/synchronize",
      ({ userId, params, body }) => {
        const hub = service.requireMobileHub(userId, params.id);
        const command = {
          commandId: randomUUID(),
          type: "synchronize-local-hub",
          nodeId: hub.id,
          endpoints: normalizeClientEndpoints(body?.endpoints),
          requestedAt: Date.now()
        };
        const delivery = syncEventBroker.publish(userId, "hub-command", command, {
          queueWhenOffline: true,
          alwaysQueue: true,
          clientId: hub.client?.id || ""
        });
        return {
          data: {
            requested: true,
            delivered: delivery.delivered,
            queued: delivery.queued,
            nodeId: hub.id,
            requestedAt: command.requestedAt
          }
        };
      }
    );
    router.add(
      "POST",
      "/api/v1/cluster/mobile-hubs/:id/switch",
      ({ userId, params, body }) => {
        const hub = service.requireMobileHub(userId, params.id);
        if (!hub.active && !hub.ready) {
          throw new HttpError(
            409,
            "MOBILE_HUB_NOT_READY",
            "手机 Hub 尚未完成全量迁入与完整性校验，不能切换。"
          );
        }
        const target = hub.active ? "desktop" : "mobile";
        if (!hub.client?.id) {
          throw new HttpError(
            409,
            "MOBILE_HUB_CONTROL_OFFLINE",
            "手机端尚未建立实时控制通道，请先打开手机上的 AetherX。"
          );
        }
        const command = {
          commandId: randomUUID(),
          type: target === "mobile" ? "switch-local-hub" : "switch-desktop-hub",
          nodeId: hub.id,
          endpoints: normalizeClientEndpoints(body?.endpoints),
          requestedAt: Date.now()
        };
        const delivery = syncEventBroker.publish(userId, "hub-command", command, {
          queueWhenOffline: true,
          alwaysQueue: true,
          clientId: hub.client.id
        });
        if (delivery.delivered === 0 && !delivery.queued) {
          throw new HttpError(
            409,
            "MOBILE_HUB_CONTROL_OFFLINE",
            "手机端实时控制通道尚未连接，请先打开手机上的 AetherX。"
          );
        }
        return {
          data: {
            requested: true,
            delivered: delivery.delivered,
            queued: delivery.queued,
            nodeId: hub.id,
            target,
            requestedAt: command.requestedAt
          }
        };
      },
      { allowDuringClusterTransition: true }
    );
  }
  if (switchPreflightService) {
    router.add(
      "POST",
      "/api/v1/cluster/switch/preflight",
      async ({ userId, body }) => ({
        data: await switchPreflightService.inspect(userId, body)
      })
    );
  }
  if (switchStateMachineService) {
    router.add(
      "POST",
      "/api/v1/cluster/switch/prepare",
      async ({ userId, body }) => ({
        data: await switchStateMachineService.prepare(userId, body)
      })
    );
    router.add(
      "POST",
      "/api/v1/cluster/switch/commit",
      async ({ userId, body }) => ({
        data: await switchStateMachineService.commit(userId, body)
      }),
      { allowDuringClusterTransition: true }
    );
    router.add(
      "POST",
      "/api/v1/cluster/switch/abort",
      async ({ userId, body }) => ({
        data: await switchStateMachineService.abort(userId, body)
      }),
      { allowDuringClusterTransition: true }
    );
  }
  if (switchRecoveryService) {
    router.add(
      "GET",
      "/api/v1/cluster/switch/recovery",
      ({ userId }) => ({ data: switchRecoveryService.status(userId) })
    );
    router.add(
      "POST",
      "/api/v1/cluster/switch/recover",
      async ({ userId }) => ({ data: await switchRecoveryService.runNow(userId) }),
      { allowDuringClusterTransition: true }
    );
  }
  if (clientSessionHandoffService) {
    router.add(
      "POST",
      "/api/v1/cluster/session-handoff",
      async ({ userId }) => ({
        data: await clientSessionHandoffService.handoff(userId)
      }),
      { allowDuringClusterTransition: true }
    );
  }
}

function normalizeClientEndpoints(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const candidate of value.slice(0, 8)) {
    const transport = candidate?.transport === "lan" ? "lan" :
      candidate?.transport === "anywhere" ? "anywhere" : "";
    let url;
    try { url = new URL(String(candidate?.address || "")); } catch { continue; }
    const validLan = transport === "lan" &&
      url.protocol === "http:" && isPrivateIpv4(url.hostname);
    const validAnywhere = transport === "anywhere" && url.protocol === "https:";
    if (!validLan && !validAnywhere) continue;
    const priority = Math.max(-1000, Math.min(1000, Number(candidate?.priority) || 0));
    result.push({
      transport,
      address: url.origin,
      priority,
      certificateFingerprint: String(candidate?.certificateFingerprint || "").slice(0, 256)
    });
  }
  return [...new Map(result.map((endpoint) => [
    `${endpoint.transport}\u0000${endpoint.address}`,
    endpoint
  ])).values()].sort((left, right) => right.priority - left.priority);
}

function isPrivateIpv4(value) {
  const parts = String(value || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

module.exports = { registerClusterRoutes };
