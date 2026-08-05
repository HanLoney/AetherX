function registerReplicationSchedulerRoutes(router, scheduler) {
  router.add(
    "GET",
    "/api/v1/replication/status",
    ({ userId }) => ({ data: scheduler.status(userId) }),
    { parseBody: false }
  );
  router.add(
    "POST",
    "/api/v1/replication/sync",
    async ({ userId }) => ({ data: await scheduler.runNow(userId) })
  );
}

module.exports = { registerReplicationSchedulerRoutes };
