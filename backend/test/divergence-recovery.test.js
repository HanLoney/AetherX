const assert = require("node:assert/strict");
const { createHash, createHmac } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { openDatabase } = require("../src/infrastructure/database");
const { createSecretBox } = require("../src/infrastructure/secret-box");
const { ArchiveService } = require("../src/modules/archive/archive-service");
const {
  DivergenceRecoveryService
} = require("../src/modules/hub-cluster/divergence-recovery-service");
const {
  ForcedTakeoverRepository
} = require("../src/modules/hub-cluster/forced-takeover-repository");
const {
  ClusterRepository
} = require("../src/modules/hub-cluster/cluster-repository");
const {
  ClusterService
} = require("../src/modules/hub-cluster/cluster-service");
const {
  buildOperation,
  canonicalStringify,
  sha256Canonical
} = require("../src/modules/replication/operation-codec");
const {
  encryptPayload
} = require("../src/modules/replication/integrity-service");
const {
  ReplicationRepository
} = require("../src/modules/replication/replication-repository");

const USER_ID = "divergence-recovery-user";
const SPACE_ID = "divergence-recovery-space";
const DESKTOP_NODE_ID = "divergence-desktop";
const MOBILE_NODE_ID = "divergence-mobile";
const TAKEOVER_ID = "divergence-takeover";
const SYNC_KEY = Buffer.alloc(32, 0x5c);

test("desktop authority prepares an encrypted snapshot and rejects tampering", async () => {
  await withFixture(async (fixture) => {
    const recovery = await fixture.service.initiate(USER_ID, { authority: "desktop" });

    assert.equal(recovery.authorityNodeId, DESKTOP_NODE_ID);
    assert.equal(recovery.targetNodeId, MOBILE_NODE_ID);
    assert.equal(recovery.status, "awaiting_peer_ack");
    assert.match(recovery.snapshotHash, /^[a-f0-9]{64}$/);
    assert.equal(
      fixture.service.peerStatus(USER_ID, MOBILE_NODE_ID, recovery.id).spaceId,
      SPACE_ID
    );
    assert.equal(fixture.commands.length, 1);
    assert.equal(fixture.commands[0].type, "resolve-hub-divergence");

    const row = fixture.takeoverRepository.findRecovery(recovery.id);
    const envelope = JSON.parse(row.encrypted_snapshot_json);
    const last = envelope.ciphertext.at(-1);
    envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}${last === "A" ? "B" : "A"}`;
    assert.throws(
      () => fixture.service.verifyEnvelope(fixture.context(), row, envelope),
      (error) => error.code === "SNAPSHOT_PAYLOAD_INVALID"
    );

    const broken = buildOperation({
      protocolVersion: 1,
      operationId: "broken-operation",
      spaceId: SPACE_ID,
      originNodeId: DESKTOP_NODE_ID,
      originSequence: 2,
      epoch: 2,
      entityType: "todos",
      entityId: "broken-todo",
      operation: "upsert",
      entityVersion: 1,
      previousEntityVersion: null,
      payload: { id: "broken-todo", text: "broken" },
      previousOperationHash: "",
      createdAt: fixture.now()
    }, { syncKey: SYNC_KEY });
    assert.throws(
      () => fixture.service.validateReplication(
        fixture.context(),
        row,
        { operations: [broken], entityVersions: [] },
        { operations: { [DESKTOP_NODE_ID]: { sequence: 1, operationHash: broken.operationHash } } }
      ),
      (error) => error.code === "DIVERGENCE_OPERATION_CHAIN_BROKEN"
    );
  });
});

test("mobile snapshot upload rejects bad hashes and discontinuous offsets", async () => {
  await withFixture(async (fixture) => {
    const recovery = fixture.takeoverRepository.createRecovery({
      id: "chunk-recovery",
      spaceId: SPACE_ID,
      takeoverId: TAKEOVER_ID,
      authorityNodeId: MOBILE_NODE_ID,
      targetNodeId: DESKTOP_NODE_ID,
      sourceEpoch: 2,
      targetEpoch: 3,
      status: "awaiting_mobile_snapshot",
      createdAt: fixture.now()
    });
    const first = Buffer.from("first recovery chunk", "utf8");
    const second = Buffer.from("second recovery chunk", "utf8");

    assert.equal(fixture.service.receiveSnapshotChunk(
      USER_ID,
      MOBILE_NODE_ID,
      recovery.id,
      { offset: 0, data: first.toString("base64"), chunkHash: sha256(first) }
    ).receivedBytes, first.length);
    assert.equal(fixture.service.receiveSnapshotChunk(
      USER_ID,
      MOBILE_NODE_ID,
      recovery.id,
      { offset: 0, data: first.toString("base64"), chunkHash: sha256(first) }
    ).duplicate, true);
    assert.throws(
      () => fixture.service.receiveSnapshotChunk(
        USER_ID,
        MOBILE_NODE_ID,
        recovery.id,
        { offset: first.length, data: second.toString("base64"), chunkHash: "0".repeat(64) }
      ),
      (error) => error.code === "DIVERGENCE_SNAPSHOT_CHUNK_HASH_MISMATCH"
    );
    assert.throws(
      () => fixture.service.receiveSnapshotChunk(
        USER_ID,
        MOBILE_NODE_ID,
        recovery.id,
        { offset: first.length + 1, data: second.toString("base64"), chunkHash: sha256(second) }
      ),
      (error) => error.code === "DIVERGENCE_SNAPSHOT_OFFSET_MISMATCH" &&
        error.details.expectedOffset === first.length
    );
    await assert.rejects(
      () => fixture.service.completeSnapshotUpload(
        USER_ID,
        MOBILE_NODE_ID,
        recovery.id,
        { byteSize: first.length, payloadHash: "0".repeat(64) }
      )
    );
    assert.equal(fixture.takeoverRepository.findRecovery(recovery.id).status, "failed");
    assert.equal(fixture.takeoverRepository.recoveryChunks(recovery.id).length, 0);
  });
});

test("mobile authority restores data, archives divergence, and closes on a signed acknowledgement", async () => {
  await withFixture(async (fixture) => {
    fixture.database.prepare(
      `INSERT INTO todos(
         id, user_id, text, start_at, end_at, completed, created_at, updated_at
       ) VALUES ('authority-todo', ?, '手机权威内容', 1, 2, 0, 1, 1)`
    ).run(USER_ID);
    const recovery = fixture.takeoverRepository.createRecovery({
      id: "mobile-authority-recovery",
      spaceId: SPACE_ID,
      takeoverId: TAKEOVER_ID,
      authorityNodeId: MOBILE_NODE_ID,
      targetNodeId: DESKTOP_NODE_ID,
      sourceEpoch: 2,
      targetEpoch: 3,
      status: "awaiting_mobile_snapshot",
      createdAt: fixture.now()
    });
    const snapshot = await fixture.archiveService.collectSnapshot(USER_ID);
    const packageValue = fixture.service.createPackage(fixture.context(), recovery, snapshot);
    const snapshotHash = sha256Canonical(packageValue);
    const envelope = encryptPayload(packageValue, SYNC_KEY, recoveryAad(recovery, snapshotHash));
    const encoded = Buffer.from(canonicalStringify(envelope), "utf8");

    fixture.database.prepare(
      "UPDATE todos SET text = '电脑分歧内容', updated_at = 2 WHERE id = 'authority-todo'"
    ).run();
    const divergentOperation = buildOperation({
      protocolVersion: 1,
      operationId: "desktop-divergent-operation",
      spaceId: SPACE_ID,
      originNodeId: DESKTOP_NODE_ID,
      originSequence: 1,
      epoch: 1,
      entityType: "todos",
      entityId: "authority-todo",
      operation: "upsert",
      entityVersion: 1,
      previousEntityVersion: null,
      payload: { id: "authority-todo", text: "电脑分歧内容" },
      previousOperationHash: "",
      createdAt: fixture.now()
    }, { syncKey: SYNC_KEY });
    fixture.replicationRepository.insertOperation(divergentOperation);
    fixture.database.prepare(
      `INSERT INTO hub_divergent_operations(
         space_id, takeover_id, operation_id, origin_node_id, origin_sequence,
         epoch, entity_type, entity_id, operation_hash, status, quarantined_at
       ) VALUES (?, ?, ?, ?, 1, 1, 'todos', 'authority-todo', ?, 'quarantined', ?)`
    ).run(
      SPACE_ID,
      TAKEOVER_ID,
      divergentOperation.operationId,
      DESKTOP_NODE_ID,
      divergentOperation.operationHash,
      fixture.now()
    );

    fixture.service.receiveSnapshotChunk(USER_ID, MOBILE_NODE_ID, recovery.id, {
      offset: 0,
      data: encoded.toString("base64"),
      chunkHash: sha256(encoded)
    });
    const completedUpload = await fixture.service.completeSnapshotUpload(
      USER_ID,
      MOBILE_NODE_ID,
      recovery.id,
      { byteSize: encoded.length, payloadHash: sha256Canonical(envelope) }
    );

    assert.equal(completedUpload.recovery.status, "awaiting_peer_ack");
    assert.equal(fixture.context().state, "recovering_divergence");
    assert.equal(
      fixture.database.prepare("SELECT text FROM todos WHERE id = 'authority-todo'").get().text,
      "手机权威内容"
    );
    assert.equal(
      fixture.database.prepare("SELECT COUNT(*) AS count FROM replication_operations").get().count,
      0
    );
    const ack = {
      recoveryId: recovery.id,
      spaceId: SPACE_ID,
      nodeId: MOBILE_NODE_ID,
      authorityNodeId: MOBILE_NODE_ID,
      epoch: 3,
      snapshotHash,
      appliedAt: fixture.now()
    };
    assert.throws(
      () => fixture.service.acknowledge(USER_ID, MOBILE_NODE_ID, recovery.id, {
        ack,
        authenticationTag: "0".repeat(64)
      }),
      (error) => error.code === "DIVERGENCE_RECOVERY_ACK_INVALID"
    );

    const result = fixture.service.acknowledge(USER_ID, MOBILE_NODE_ID, recovery.id, {
      ack,
      authenticationTag: createHmac("sha256", SYNC_KEY)
        .update(canonicalStringify(ack), "utf8")
        .digest("hex")
    });
    const status = fixture.clusterService.status(USER_ID);
    const evidence = fixture.service.exportEvidence(USER_ID);
    assert.equal(result.status, "completed");
    assert.equal(status.state, "stable");
    assert.equal(status.epoch, 3);
    assert.equal(status.activeNodeId, MOBILE_NODE_ID);
    assert.equal(status.localRole, "standby");
    assert.equal(status.forcedTakeover.divergentOperationCount, 1);
    assert.equal(evidence.takeover.status, "reconciled");
    assert.equal(evidence.divergentOperations.length, 1);
    assert.equal(evidence.divergentOperations[0].divergenceStatus, "kept_mobile");
  });
});

async function withFixture(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-divergence-recovery-"));
  const database = openDatabase(dataDir);
  try {
    seedDatabase(database);
    const clusterRepository = new ClusterRepository(database);
    const takeoverRepository = new ForcedTakeoverRepository(database);
    const baseClusterService = new ClusterService(clusterRepository, {
      forcedTakeoverProvider: (spaceId) => takeoverRepository.status(spaceId)
    });
    const clusterService = {
      ensureSpace: (userId) => baseClusterService.ensureSpace(userId),
      requireMobileHub: () => ({ client: { id: "mobile-client" } }),
      status: (userId) => baseClusterService.status(userId)
    };
    const replicationRepository = new ReplicationRepository(database);
    const archiveService = new ArchiveService({
      database,
      secretBox: createSecretBox(dataDir, "divergence-recovery-master-key"),
      dataDir
    });
    const commands = [];
    let clock = 1780000100000;
    const service = new DivergenceRecoveryService({
      database,
      clusterService,
      clusterRepository,
      repository: takeoverRepository,
      replicationRepository,
      archiveService,
      spaceKeyService: { ensure: () => ({ key: SYNC_KEY }) },
      syncEventBroker: {
        publish: (_userId, _event, command) => {
          commands.push(command);
          return { delivered: 1, queued: true };
        }
      },
      now: () => clock++
    });
    await run({
      archiveService,
      clusterService,
      commands,
      context: () => baseClusterService.ensureSpace(USER_ID),
      database,
      now: () => clock++,
      replicationRepository,
      service,
      takeoverRepository
    });
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function seedDatabase(database) {
  const now = 1780000000000;
  const schemaVersion = Number(
    database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version
  );
  database.prepare(
    `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
     VALUES (?, ?, 'Recovery User', 'test-password-hash', 1, 1)`
  ).run(USER_ID, USER_ID);
  database.prepare(
    `INSERT INTO hub_instance(
       singleton, node_id, node_name, platform, public_identity,
       protocol_version, schema_version, created_at, updated_at
     ) VALUES (1, ?, 'Desktop Hub', 'win32', ?, 1, ?, ?, ?)`
  ).run(DESKTOP_NODE_ID, `identity:${DESKTOP_NODE_ID}`, schemaVersion, now, now);
  database.prepare(
    `INSERT INTO aetherx_spaces(id, local_user_id, display_name, created_at, updated_at)
     VALUES (?, ?, 'Recovery Space', ?, ?)`
  ).run(SPACE_ID, USER_ID, now, now);
  const insertNode = database.prepare(
    `INSERT INTO hub_nodes(
       id, space_id, node_name, platform, public_identity, protocol_version,
       schema_version, status, last_seen_at, created_at, revoked_at
     ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`
  );
  insertNode.run(
    DESKTOP_NODE_ID,
    SPACE_ID,
    "Desktop Hub",
    "win32",
    `identity:${DESKTOP_NODE_ID}`,
    schemaVersion,
    "standby",
    now,
    now
  );
  insertNode.run(
    MOBILE_NODE_ID,
    SPACE_ID,
    "Mobile Hub",
    "android",
    `identity:${MOBILE_NODE_ID}`,
    schemaVersion,
    "active",
    now,
    now
  );
  const state = {
    spaceId: SPACE_ID,
    epoch: 2,
    activeNodeId: MOBILE_NODE_ID,
    transitionId: TAKEOVER_ID,
    state: "divergent"
  };
  database.prepare(
    `INSERT INTO hub_cluster_state(
       space_id, epoch, active_node_id, transition_id, state, state_hash,
       control_signature, updated_at, transition_target_node_id, transition_started_at
     ) VALUES (?, 2, ?, ?, 'divergent', ?, '', ?, ?, ?)`
  ).run(
    SPACE_ID,
    MOBILE_NODE_ID,
    TAKEOVER_ID,
    sha256Canonical(state),
    now,
    MOBILE_NODE_ID,
    now
  );
  database.prepare(
    `INSERT INTO hub_forced_takeovers(
       id, space_id, previous_active_node_id, active_node_id, previous_epoch,
       epoch, proof_json, proof_hash, control_signature, integrity_json,
       status, detected_at, reconciled_at
     ) VALUES (?, ?, ?, ?, 1, 2, ?, ?, ?, ?, 'accepted', ?, NULL)`
  ).run(
    TAKEOVER_ID,
    SPACE_ID,
    DESKTOP_NODE_ID,
    MOBILE_NODE_ID,
    JSON.stringify({ takeoverId: TAKEOVER_ID }),
    "a".repeat(64),
    "b".repeat(64),
    JSON.stringify({ recordsRoot: "c".repeat(64) }),
    now
  );
}

function recoveryAad(recovery, snapshotHash) {
  return {
    purpose: "aetherx-divergence-recovery",
    recoveryId: recovery.id,
    takeoverId: recovery.takeover_id,
    spaceId: recovery.space_id,
    authorityNodeId: recovery.authority_node_id,
    targetNodeId: recovery.target_node_id,
    sourceEpoch: Number(recovery.source_epoch),
    targetEpoch: Number(recovery.target_epoch),
    snapshotHash
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
