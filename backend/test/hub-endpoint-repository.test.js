const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const {
  HubEndpointRepository
} = require("../src/modules/hub-cluster/hub-endpoint-repository");

test("endpoint snapshots retain health history for unchanged addresses", () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-endpoints-"));
  const database = new DatabaseSync(path.join(dataDir, "endpoints.db"));
  try {
    database.exec(`
      CREATE TABLE hub_endpoints (
        id TEXT PRIMARY KEY,
        space_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        transport TEXT NOT NULL,
        address TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        certificate_fingerprint TEXT NOT NULL DEFAULT '',
        last_success_at INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_failure_at INTEGER,
        failure_count INTEGER NOT NULL DEFAULT 0,
        UNIQUE(space_id, node_id, transport, address)
      )
    `);

    const repository = new HubEndpointRepository(database);
    const initial = repository.replaceNodeEndpoints("space-1", "mobile-1", [
      endpoint("lan", "http://192.168.1.20:4319", 500),
      endpoint("tailscale", "http://100.100.10.20:4319", 350)
    ], 100);
    repository.markSuccess(initial[0].id, 110);
    repository.markFailure(initial[1].id, 120);

    const refreshed = repository.replaceNodeEndpoints("space-1", "mobile-1", [
      endpoint("lan", "http://192.168.1.20:4319", 550),
      endpoint("tailscale", "http://100.100.10.20:4319", 375)
    ], 200);

    const lan = refreshed.find((item) => item.transport === "lan");
    const tailscale = refreshed.find((item) => item.transport === "tailscale");
    assert.equal(lan.id, initial[0].id);
    assert.equal(lan.priority, 550);
    assert.equal(lan.lastSuccessAt, 110);
    assert.equal(tailscale.id, initial[1].id);
    assert.equal(tailscale.failureCount, 1);
    assert.equal(tailscale.lastFailureAt, 120);

    repository.markFailure(lan.id, 210);
    repository.markSuccess(tailscale.id, 220);
    assert.deepEqual(
      repository.listForNode("space-1", "mobile-1").map((item) => item.transport),
      ["tailscale", "lan"]
    );

    const cellularOnly = repository.replaceNodeEndpoints("space-1", "mobile-1", [
      endpoint("tailscale", "http://100.100.10.20:4319", 375)
    ], 300);
    assert.deepEqual(cellularOnly.map((item) => item.transport), ["tailscale"]);
    assert.equal(cellularOnly[0].id, initial[1].id);
    assert.equal(cellularOnly[0].failureCount, 0);
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

function endpoint(transport, address, priority) {
  return { transport, address, priority, certificateFingerprint: "" };
}
