const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createHubControlServer,
  getHubControlPipe,
  requestHubControl
} = require("../src/infrastructure/hub-control-channel");

test("Hub control channel reports ownership and accepts graceful stop", async () => {
  const pipe = getHubControlPipe(`backend-test-${process.pid}`);
  let stopping = false;
  const server = await createHubControlServer(pipe, async (command) => {
    if (command === "status") {
      return { component: "hub", pid: process.pid, dataDir: "test-data", healthy: true };
    }
    if (command === "stop") {
      stopping = true;
      return { stopping: true };
    }
    throw new Error("unsupported");
  });
  try {
    const status = await requestHubControl(pipe, "status");
    assert.equal(status.ok, true);
    assert.equal(status.component, "hub");
    assert.equal(status.pid, process.pid);
    assert.equal(status.dataDir, "test-data");
    const stopped = await requestHubControl(pipe, "stop");
    assert.equal(stopped.ok, true);
    assert.equal(stopped.stopping, true);
    assert.equal(stopping, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
