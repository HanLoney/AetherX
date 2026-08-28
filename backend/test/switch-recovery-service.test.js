const test = require("node:test");
const assert = require("node:assert/strict");
const { SwitchRecoveryService } = require(
  "../src/modules/hub-cluster/switch-recovery-service"
);

function createHarness(options = {}) {
  let now = 100_000;
  let context = {
    state: "final_sync",
    local_node_id: "desktop",
    active_node_id: "desktop",
    transition_id: "transition-1",
    state_updated_at: options.stateUpdatedAt ?? 0
  };
  let busy = options.busy === true;
  let aborts = 0;
  const service = new SwitchRecoveryService({
    clusterService: { ensureSpace: () => ({ ...context }) },
    clusterRepository: { listSpaceUserIds: () => ["user-1"] },
    switchStateMachineService: {
      isBusy: () => busy,
      abort: async () => {
        aborts += 1;
        context = { ...context, state: "stable", transition_id: "" };
        return { aborted: true };
      },
      commit: async () => {
        throw new Error("commit should not run");
      }
    },
    recoveryGraceMs: 30_000,
    now: () => now
  });
  return {
    service,
    aborts: () => aborts,
    setBusy: (value) => { busy = value; },
    setNow: (value) => { now = value; }
  };
}

test("automatic recovery does not abort an in-flight switch", async () => {
  const harness = createHarness({ busy: true });

  await harness.service.tick();

  assert.equal(harness.aborts(), 0);
});

test("automatic recovery handles the same transition after it is no longer in flight", async () => {
  const harness = createHarness({ busy: true });
  await harness.service.tick();
  harness.setBusy(false);

  await harness.service.tick();

  assert.equal(harness.aborts(), 1);
});

test("automatic recovery leaves a recently updated transition alone", async () => {
  const harness = createHarness({ stateUpdatedAt: 90_000 });

  await harness.service.tick();

  assert.equal(harness.aborts(), 0);
  harness.setNow(121_000);
  await harness.service.tick();
  assert.equal(harness.aborts(), 1);
});

test("manual recovery rejects while the switch state machine is busy", async () => {
  const harness = createHarness({ busy: true });

  await assert.rejects(
    harness.service.runNow("user-1"),
    (error) => error.code === "SWITCH_RECOVERY_BUSY"
  );
  assert.equal(harness.aborts(), 0);
});
