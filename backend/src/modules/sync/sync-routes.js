const { HttpError } = require("../../lib/http-error");

function registerSyncRoutes(router, service, eventBroker, deviceService) {
  router.add("GET", "/api/v1/sync/changes", ({ userId, query }) => ({
    data: service.listChanges(userId, query)
  }));
  router.add(
    "GET",
    "/api/v1/sync/events",
    ({ request, response, userId, query }) => {
      const after = parseCursor(query.after);
      eventBroker.subscribe({
        request,
        response,
        userId,
        after,
        clientId: query.client_id || "",
        onConnectionChange: (connected, cursor) =>
          deviceService?.setSseConnection(userId, query.client_id, connected, cursor)
      });
      return { handled: true };
    }
  );
}

function parseCursor(value) {
  if (value === undefined || value === "") return 0;
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0) {
    throw new HttpError(400, "INVALID_SYNC_CURSOR", "同步游标无效。");
  }
  return cursor;
}

module.exports = { registerSyncRoutes };
