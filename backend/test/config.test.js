const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

test("registration mode defaults to open", () => {
  const config = loadConfig({});
  assert.equal(config.registrationMode, "open");
  assert.equal(config.replicationSchedulerEnabled, true);
  assert.equal(config.switchRecoveryEnabled, true);
  assert.equal(config.replicationPollIntervalMs, 5000);
  assert.equal(config.replicationMaxBackoffMs, 300000);
});

test("registration mode rejects unsafe typos", () => {
  assert.throws(
    () => loadConfig({ AETHERX_REGISTRATION_MODE: "invte" }),
    /open, invite or closed/
  );
  assert.equal(
    loadConfig({ AETHERX_SWITCH_RECOVERY_ENABLED: "false" })
      .switchRecoveryEnabled,
    false
  );
  assert.throws(
    () => loadConfig({ AETHERX_SWITCH_RECOVERY_ENABLED: "sometimes" }),
    /AETHERX_SWITCH_RECOVERY_ENABLED must be true or false/
  );
});

test("replication scheduler config rejects ambiguous values", () => {
  assert.equal(
    loadConfig({ AETHERX_REPLICATION_SCHEDULER_ENABLED: "off" })
      .replicationSchedulerEnabled,
    false
  );
  assert.throws(
    () => loadConfig({ AETHERX_REPLICATION_SCHEDULER_ENABLED: "maybe" }),
    /must be true or false/
  );
});
