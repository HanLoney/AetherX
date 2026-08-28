const test = require("node:test");
const assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const { DeviceService } = require("../src/modules/devices/device-service");
const { DeviceRepository } = require("../src/modules/devices/device-repository");

function repositoryFor({ deviceStatus = "active", linkedHubs = [] } = {}) {
  const calls = [];
  return {
    calls,
    transaction(run) {
      calls.push("transaction");
      return run();
    },
    findDevice() {
      return { id: "device-1", status: deviceStatus };
    },
    listLinkedHubNodes() {
      return linkedHubs;
    },
    revokeDevice() {
      calls.push("revoke-device");
    },
    revokeLinkedHubNodes() {
      calls.push("revoke-hubs");
    }
  };
}

test("revoking a device also revokes its standby Hub", () => {
  const repository = repositoryFor({
    linkedHubs: [{ id: "mobile-hub", is_active: 0 }]
  });
  new DeviceService(repository).revokeDevice("user-1", "device-1");
  assert.deepEqual(repository.calls, ["transaction", "revoke-device", "revoke-hubs"]);
});

test("revoking an already revoked device cleans up legacy Hub records", () => {
  const repository = repositoryFor({
    deviceStatus: "revoked",
    linkedHubs: [{ id: "legacy-hub", is_active: 0 }]
  });
  new DeviceService(repository).revokeDevice("user-1", "device-1");
  assert.deepEqual(repository.calls, ["transaction", "revoke-hubs"]);
});

test("an active Hub must be switched away before its device is revoked", () => {
  const repository = repositoryFor({
    linkedHubs: [{ id: "mobile-hub", is_active: 1 }]
  });
  assert.throws(
    () => new DeviceService(repository).revokeDevice("user-1", "device-1"),
    (error) => error.status === 409 && error.code === "DEVICE_HUB_ACTIVE"
  );
  assert.deepEqual(repository.calls, ["transaction"]);
});

test("device revocation atomically revokes the linked Hub and Peer credential", () => {
  const database = new DatabaseSync(":memory:");
  try {
    database.exec(`
      CREATE TABLE paired_devices (
        id TEXT PRIMARY KEY, user_id TEXT, status TEXT, revoked_at INTEGER
      );
      CREATE TABLE mobile_client_health (
        id TEXT, user_id TEXT, paired_device_id TEXT, local_hub_node_id TEXT
      );
      CREATE TABLE aetherx_spaces (id TEXT PRIMARY KEY, local_user_id TEXT);
      CREATE TABLE hub_nodes (
        id TEXT, space_id TEXT, status TEXT, revoked_at INTEGER,
        PRIMARY KEY(space_id, id)
      );
      CREATE TABLE hub_cluster_state (space_id TEXT PRIMARY KEY, active_node_id TEXT);
      CREATE TABLE hub_peer_credentials (
        space_id TEXT, peer_node_id TEXT, revoked_at INTEGER
      );
      INSERT INTO paired_devices VALUES ('device-1', 'user-1', 'active', NULL);
      INSERT INTO mobile_client_health VALUES ('client-1', 'user-1', 'device-1', 'mobile-1');
      INSERT INTO aetherx_spaces VALUES ('space-1', 'user-1');
      INSERT INTO hub_nodes VALUES ('desktop-1', 'space-1', 'active', NULL);
      INSERT INTO hub_nodes VALUES ('mobile-1', 'space-1', 'standby', NULL);
      INSERT INTO hub_cluster_state VALUES ('space-1', 'desktop-1');
      INSERT INTO hub_peer_credentials VALUES ('space-1', 'mobile-1', NULL);
    `);
    const service = new DeviceService(new DeviceRepository(database));
    service.revokeDevice("user-1", "device-1");
    assert.equal(
      database.prepare("SELECT status FROM paired_devices WHERE id = 'device-1'").get().status,
      "revoked"
    );
    assert.equal(
      database.prepare("SELECT status FROM hub_nodes WHERE id = 'mobile-1'").get().status,
      "revoked"
    );
    assert.ok(
      database.prepare("SELECT revoked_at FROM hub_peer_credentials").get().revoked_at > 0
    );
  } finally {
    database.close();
  }
});
