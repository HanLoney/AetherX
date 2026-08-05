const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { HttpError } = require("../src/lib/http-error");
const { openDatabase } = require("../src/infrastructure/database");
const { createSecretBox } = require("../src/infrastructure/secret-box");
const {
  AiConfigRepository
} = require("../src/modules/ai/ai-config-repository");
const {
  ReplicatedAiConfigRepository
} = require("../src/modules/ai/replicated-ai-config-repository");
const {
  buildOperation,
  canonicalStringify,
  sha256Canonical,
  validateOperation
} = require("../src/modules/replication/operation-codec");
const {
  ClusterRepository
} = require("../src/modules/hub-cluster/cluster-repository");
const {
  ClusterService
} = require("../src/modules/hub-cluster/cluster-service");
const {
  ClientSessionHandoffService
} = require("../src/modules/hub-cluster/client-session-handoff-service");
const {
  controlHash,
  persistedState,
  signSwitchAck,
  signSwitchControl,
  stateHash,
  verifySwitchAck,
  verifySwitchControl
} = require("../src/modules/hub-cluster/switch-control-codec");
const {
  switchRecordsRoot
} = require("../src/modules/replication/integrity-service");
const {
  ReplicationRepository
} = require("../src/modules/replication/replication-repository");
const {
  ReplicationHealthRepository
} = require("../src/modules/replication/replication-health-repository");
const {
  ReplicationUnitOfWork
} = require("../src/modules/replication/replication-unit-of-work");
const { TodoRepository } = require("../src/modules/todos/todo-repository");
const { TodoService } = require("../src/modules/todos/todo-service");
const {
  ReplicatedTodoService
} = require("../src/modules/todos/replicated-todo-service");

test("client session handoff allows an Android Local Hub cold-start window", async () => {
  let peerRequest = null;
  let attempts = 0;
  const service = new ClientSessionHandoffService({
    clusterService: {
      ensureSpace: () => ({
        space_id: "space-1",
        local_node_id: "desktop-1",
        active_node_id: "android-1",
        state: "stable"
      })
    },
    clusterRepository: {
      findNode: () => ({ id: "android-1", status: "active", revoked_at: null })
    },
    peerTransport: {
      requestJson: async (_userId, _nodeId, input) => {
        peerRequest = input;
        attempts += 1;
        if (attempts === 1) {
          throw new HttpError(503, "PEER_UNREACHABLE", "Android Hub is starting.");
        }
        return {
          endpoint: { address: "http://192.168.1.8:4319", transport: "lan" },
          data: { token: "handoff-token", user: { id: "user-1" }, spaceId: "space-1" }
        };
      }
    },
    authService: {},
    sleep: async () => undefined
  });

  const result = await service.handoff("user-1");

  assert.equal(attempts, 2);
  assert.equal(peerRequest.timeoutMs, 5_000);
  assert.equal(result.handedOff, true);
  assert.equal(result.serverUrl, "http://192.168.1.8:4319");
});

test("switch integrity treats semantically identical JSON text as the same record", () => {
  const base = {
    account: { displayName: "洛尼" },
    credentials: { aiApiKey: "secret", imageApiKey: "" },
    records: Object.fromEntries(require("../src/modules/archive/archive-format").TABLES.map((table) => [table, []])),
    media: []
  };
  const left = structuredClone(base);
  const right = structuredClone(base);
  left.records.messages = [{
    id: "message-1",
    user_id: "__CURRENT_USER__",
    payload_json: '{"kind":"recall","items":[{"kind":"memory","id":"one"}]}'
  }];
  right.records.messages = [{
    id: "message-1",
    user_id: "__CURRENT_USER__",
    payload_json: '{"items":[{"id":"one","kind":"memory"}],"kind":"recall"}'
  }];
  assert.equal(switchRecordsRoot(left), switchRecordsRoot(right));
});

test("switch integrity ignores redundant object aliases beside normalized JSON columns", () => {
  const base = {
    account: { displayName: "洛尼" },
    credentials: { aiApiKey: "secret", imageApiKey: "" },
    records: Object.fromEntries(require("../src/modules/archive/archive-format").TABLES.map((table) => [table, []])),
    media: []
  };
  const desktop = structuredClone(base);
  const mobile = structuredClone(base);
  const rawPayload = { userMessage: "测试", conversationMessages: [] };
  desktop.records.xuan_mood_events = [{
    id: "event-1",
    user_id: "__CURRENT_USER__",
    raw_payload_json: JSON.stringify(rawPayload)
  }];
  mobile.records.xuan_mood_events = [{
    id: "event-1",
    user_id: "__CURRENT_USER__",
    raw_payload: rawPayload,
    raw_payload_json: JSON.stringify(rawPayload)
  }];
  assert.equal(switchRecordsRoot(desktop), switchRecordsRoot(mobile));
});

test("switch integrity treats SQLite boolean integers and JSON booleans as the same record", () => {
  const base = {
    account: { displayName: "洛尼" },
    credentials: { aiApiKey: "secret", imageApiKey: "" },
    records: Object.fromEntries(require("../src/modules/archive/archive-format").TABLES.map((table) => [table, []])),
    media: []
  };
  const desktop = structuredClone(base);
  const mobile = structuredClone(base);
  desktop.records.todos = [{ id: "todo-1", completed: 1 }];
  mobile.records.todos = [{ id: "todo-1", completed: true }];
  desktop.records.module_settings = [{ id: "module-1", enabled: 0 }];
  mobile.records.module_settings = [{ id: "module-1", enabled: false }];
  assert.equal(switchRecordsRoot(desktop), switchRecordsRoot(mobile));
});
const {
  ProfileRepository
} = require("../src/modules/profiles/profile-repository");
const { ProfileService } = require("../src/modules/profiles/profile-service");
const {
  ReplicatedProfileService
} = require("../src/modules/profiles/replicated-profile-service");
const {
  PreferenceRepository
} = require("../src/modules/preferences/preference-repository");
const {
  PreferenceService
} = require("../src/modules/preferences/preference-service");
const {
  ReplicatedPreferenceService
} = require("../src/modules/preferences/replicated-preference-service");
const { WalletRepository } = require("../src/modules/wallet/wallet-repository");
const { WalletService } = require("../src/modules/wallet/wallet-service");
const {
  ReplicatedWalletService
} = require("../src/modules/wallet/replicated-wallet-service");
const {
  ConversationRepository
} = require("../src/modules/conversations/conversation-repository");
const {
  ConversationService
} = require("../src/modules/conversations/conversation-service");
const {
  ReplicatedConversationService
} = require("../src/modules/conversations/replicated-conversation-service");
const { MemoryRepository } = require("../src/modules/memories/memory-repository");
const { MemoryService } = require("../src/modules/memories/memory-service");
const {
  MemoryEvidenceRepository
} = require("../src/modules/memories/memory-evidence-repository");
const {
  ReplicatedMemoryEvidenceRepository,
  ReplicatedMemoryService
} = require("../src/modules/memories/replicated-memory-service");
const {
  MemorySettingsRepository
} = require("../src/modules/memories/memory-settings-repository");
const {
  MemorySettingsService
} = require("../src/modules/memories/memory-settings-service");
const {
  ReplicatedMemorySettingsService
} = require("../src/modules/memories/replicated-memory-settings-service");
const {
  AssistantMemoryRepository
} = require("../src/modules/assistant-memory/assistant-memory-repository");
const {
  AssistantMemoryService
} = require("../src/modules/assistant-memory/assistant-memory-service");
const {
  ReplicatedAssistantMemoryService
} = require("../src/modules/assistant-memory/replicated-assistant-memory-service");
const { JournalRepository } = require("../src/modules/journals/journal-repository");
const { JournalService } = require("../src/modules/journals/journal-service");
const {
  ReplicatedJournalService
} = require("../src/modules/journals/replicated-journal-service");
const {
  XuanMoodRepository
} = require("../src/modules/xuan-mood/xuan-mood-repository");
const { XuanMoodService } = require("../src/modules/xuan-mood/xuan-mood-service");
const {
  ReplicatedXuanMoodService
} = require("../src/modules/xuan-mood/replicated-xuan-mood-service");
const { AlbumRepository } = require("../src/modules/album/album-repository");
const { AlbumService } = require("../src/modules/album/album-service");
const {
  ReplicatedAlbumService
} = require("../src/modules/album/replicated-album-service");
const { DreamRepository } = require("../src/modules/dreams/dream-repository");
const { DreamService } = require("../src/modules/dreams/dream-service");
const {
  ReplicatedDreamService
} = require("../src/modules/dreams/replicated-dream-service");
const {
  PeerReplicationService
} = require("../src/modules/replication/peer-replication-service");
const {
  SpaceKeyRepository
} = require("../src/modules/replication/space-key-repository");
const {
  SpaceKeyService
} = require("../src/modules/replication/space-key-service");
const {
  PeerCredentialRepository
} = require("../src/modules/replication/peer-credential-repository");
const {
  createPeerRequestHeaders,
  PeerAuthenticationService
} = require("../src/modules/replication/peer-authentication-service");
const {
  ReplicationEntityApplier
} = require("../src/modules/replication/replication-entity-applier");
const {
  ReplicationApplyService
} = require("../src/modules/replication/replication-apply-service");
const {
  buildManifest,
  merkleRoot
} = require("../src/modules/replication/integrity-service");

const fixture = require("./fixtures/replication-operation-v1.json");

test("snapshot manifests are stable and localize changed records to one table", () => {
  const context = {
    protocol_version: 1,
    schema_version: 33,
    space_id: "space-one",
    local_node_id: "node-source",
    epoch: 1
  };
  const baseSnapshot = {
    account: { displayName: "洛尼" },
    credentials: { aiApiKey: "secret", imageApiKey: "" },
    records: {
      todos: [
        { id: "todo-b", user_id: "$current-user", text: "第二条" },
        { id: "todo-a", user_id: "$current-user", text: "第一条" }
      ]
    },
    media: []
  };
  const boundary = { syncCursor: 7, operations: {} };
  const first = buildManifest({
    snapshot: baseSnapshot,
    context,
    boundary,
    now: 100
  });
  const reordered = buildManifest({
    snapshot: {
      ...baseSnapshot,
      records: { todos: [...baseSnapshot.records.todos].reverse() }
    },
    context,
    boundary,
    now: 100
  });
  assert.equal(first.manifestHash, reordered.manifestHash);
  assert.equal(first.recordsRoot, reordered.recordsRoot);

  const changed = buildManifest({
    snapshot: {
      ...baseSnapshot,
      records: {
        todos: baseSnapshot.records.todos.map((row) =>
          row.id === "todo-a" ? { ...row, text: "被修改" } : row
        )
      }
    },
    context,
    boundary,
    now: 100
  });
  const firstTables = new Map(first.tables.map((table) => [table.name, table.root]));
  const changedTables = new Map(changed.tables.map((table) => [table.name, table.root]));
  assert.notEqual(first.recordsRoot, changed.recordsRoot);
  assert.notEqual(firstTables.get("todos"), changedTables.get("todos"));
  assert.equal(firstTables.get("$account"), changedTables.get("$account"));
  assert.equal(merkleRoot([]), sha256Canonical([]));
});

test("replication operation v1 has a stable canonical digest and detects tampering", () => {
  const operation = buildOperation(fixture.input, { syncKey: fixture.syncKey });
  assert.equal(operation.payloadHash, fixture.expected.payloadHash);
  assert.equal(operation.operationHash, fixture.expected.operationHash);
  assert.equal(operation.authenticationTag, fixture.expected.authenticationTag);
  assert.deepEqual(validateOperation(operation, { syncKey: fixture.syncKey }), operation);

  const reordered = {
    ...fixture.input,
    payload: {
      metadata: { note: null, confirmed: true },
      tags: ["收入", "二手物品"],
      change_minor: 69942,
      detail: "闲鱼到账",
      source: "agent"
    }
  };
  assert.equal(
    buildOperation(reordered, { syncKey: fixture.syncKey }).operationHash,
    operation.operationHash
  );

  assert.throws(
    () => validateOperation({
      ...operation,
      payload: { ...operation.payload, change_minor: 69943 }
    }, { syncKey: fixture.syncKey }),
    (error) => error.code === "REPLICATION_OPERATION_INVALID" &&
      error.details.field === "payloadHash"
  );
  assert.throws(
    () => canonicalStringify({ invalid: undefined }),
    /不能是 undefined/
  );
  assert.throws(
    () => canonicalStringify(new Array(1)),
    /数组不能包含空位/
  );
});

test("planned switch controls and acknowledgements reject tampering and stale messages", () => {
  const key = Buffer.alloc(32, 0x4a);
  const issuedAt = 1780000000000;
  const signedControl = signSwitchControl({
    version: 1,
    action: "phase",
    spaceId: "space-switch",
    epoch: 4,
    activeNodeId: "desktop-hub",
    targetNodeId: "mobile-hub",
    transitionId: "transition-01",
    transitionStartedAt: issuedAt,
    state: "integrity_check",
    issuedAt
  }, key);
  assert.equal(
    verifySwitchControl(signedControl, key, issuedAt).state,
    "integrity_check"
  );
  assert.throws(
    () => verifySwitchControl({
      ...signedControl,
      control: { ...signedControl.control, epoch: 5 }
    }, key, issuedAt),
    (error) => error.code === "SWITCH_CONTROL_INVALID"
  );
  assert.throws(
    () => verifySwitchControl(signedControl, key, issuedAt + 30_001),
    (error) => error.code === "SWITCH_CONTROL_INVALID"
  );
  assert.throws(
    () => signSwitchControl({ ...signedControl.control, version: 2 }, key),
    (error) => error.code === "SWITCH_CONTROL_INVALID"
  );

  const expectedStateHash = stateHash(persistedState(signedControl.control));
  const signedAck = signSwitchAck({
    version: 1,
    controlHash: controlHash(signedControl.control),
    nodeId: "mobile-hub",
    state: "integrity_check",
    epoch: 4,
    stateHash: expectedStateHash,
    appliedAt: issuedAt
  }, key);
  assert.equal(verifySwitchAck(signedAck, key, {
    controlHash: controlHash(signedControl.control),
    nodeId: "mobile-hub",
    state: "integrity_check",
    epoch: 4,
    stateHash: expectedStateHash
  }).stateHash, expectedStateHash);
  const wrongStateAck = signSwitchAck({
    ...signedAck.ack,
    stateHash: "0".repeat(64)
  }, key);
  assert.throws(
    () => verifySwitchAck(wrongStateAck, key, { stateHash: expectedStateHash }),
    (error) => error.code === "SWITCH_CONTROL_INVALID"
  );
});

test("schema migration creates the single-node cluster and replication foundation", () => {
  withDatabase(({ database }) => {
    createUser(database, "user-one");
    const service = new ClusterService(new ClusterRepository(database), {
      nodeName: "测试电脑 Hub",
      platform: "win32"
    });
    const first = service.status("user-one");
    const second = service.status("user-one");

    assert.equal(first.spaceId, second.spaceId);
    assert.equal(first.localNodeId, second.localNodeId);
    assert.equal(first.activeNodeId, first.localNodeId);
    assert.equal(first.localRole, "active");
    assert.equal(first.epoch, 1);
    assert.equal(first.state, "stable");
    assert.equal(first.replication.configured, false);
    assert.equal(first.replication.peerCount, 0);
    assert.equal(first.nodes.length, 1);
    assert.equal(first.nodes[0].name, "测试电脑 Hub");
    assert.match(first.stateHash, /^[a-f0-9]{64}$/);
    assert.equal(
      first.schemaVersion,
      Number(database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version)
    );

    const expectedTables = [
      "aetherx_spaces",
      "applied_operations",
      "hub_cluster_state",
      "hub_endpoints",
      "hub_instance",
      "hub_nodes",
      "hub_pairing_sessions",
      "idempotency_requests",
      "replication_operations",
      "replication_peer_health",
      "replication_media_staging",
      "replication_entity_versions",
      "replication_blob_staging",
      "replication_bootstrap_staging",
      "replication_snapshot_payloads",
      "replication_snapshots",
      "replication_snapshot_tables",
      "replication_watermarks",
      "space_data_keys",
      "hub_peer_credentials",
      "peer_request_nonces"
    ];
    assert.deepEqual(
      database
        .prepare(
          `SELECT name FROM sqlite_schema
           WHERE type = 'table' AND name IN (${expectedTables.map(() => "?").join(",")})
           ORDER BY name`
        )
        .all(...expectedTables)
        .map((row) => row.name),
      [...expectedTables].sort()
    );
  });
});

test("replication unit of work writes a hash chain and deduplicates requests", () => {
  withDatabase(({ database }) => {
    createUser(database, "user-two");
    const clusterService = new ClusterService(new ClusterRepository(database), {
      nodeName: "测试手机 Hub",
      platform: "android"
    });
    const repository = new ReplicationRepository(database);
    const notifications = [];
    const unitOfWork = new ReplicationUnitOfWork({
      repository,
      clusterService,
      onOperationsCommitted: (userId, change) => notifications.push({
        userId,
        change,
        committedOperationCount: Number(
          database.prepare("SELECT COUNT(*) AS count FROM replication_operations").get().count
        )
      }),
      now: () => 1780000000000
    });
    let calls = 0;
    const executeCreate = () => unitOfWork.execute("user-two", "request-create-todo", () => {
      calls += 1;
      database.prepare(
        `INSERT INTO todos(
           id, user_id, text, start_at, end_at, completed, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run("todo-one", "user-two", "整理双 Hub 协议", 1000, 2000, 500, 500);
      return {
        status: 201,
        result: { id: "todo-one", text: "整理双 Hub 协议" },
        changes: [{
          entityType: "todos",
          entityId: "todo-one",
          operation: "upsert",
          entityVersion: 1,
          previousEntityVersion: null,
          payload: {
            id: "todo-one",
            text: "整理双 Hub 协议",
            start_at: 1000,
            end_at: 2000,
            completed: false,
            created_at: 500,
            updated_at: 500
          }
        }]
      };
    });

    const created = executeCreate();
    const repeated = executeCreate();
    assert.equal(calls, 1);
    assert.equal(created.repeated, false);
    assert.equal(repeated.repeated, true);
    assert.deepEqual(repeated.result, created.result);
    assert.equal(created.operations.length, 1);
    assert.equal(created.operations[0].originSequence, 1);
    assert.equal(created.operations[0].previousOperationHash, "");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].userId, "user-two");
    assert.equal(notifications[0].change.operationCount, 1);
    assert.equal(notifications[0].change.headSequence, 1);
    assert.equal(notifications[0].committedOperationCount, 1);

    const updated = unitOfWork.execute("user-two", "request-update-todo", () => {
      database.prepare(
        "UPDATE todos SET completed = 1, updated_at = 600 WHERE user_id = ? AND id = ?"
      ).run("user-two", "todo-one");
      return {
        result: { id: "todo-one", completed: true },
        changes: [{
          entityType: "todos",
          entityId: "todo-one",
          operation: "upsert",
          entityVersion: 2,
          previousEntityVersion: 1,
          payload: { id: "todo-one", completed: true, updated_at: 600 }
        }]
      };
    });
    assert.equal(updated.operations[0].originSequence, 2);
    assert.equal(
      updated.operations[0].previousOperationHash,
      created.operations[0].operationHash
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM replication_operations").get().count,
      2
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM idempotency_requests").get().count,
      2
    );
    assert.equal(notifications.length, 2);
    assert.equal(notifications[1].change.headSequence, 2);
    assert.equal(notifications[1].committedOperationCount, 2);
  });
});

test("replication unit of work rolls back business data when operation creation fails", () => {
  withDatabase(({ database }) => {
    createUser(database, "user-three");
    const clusterService = new ClusterService(new ClusterRepository(database), {
      nodeName: "回滚测试 Hub"
    });
    const unitOfWork = new ReplicationUnitOfWork({
      repository: new ReplicationRepository(database),
      clusterService
    });

    assert.throws(() => unitOfWork.execute("user-three", "request-invalid", () => {
      database.prepare(
        `INSERT INTO todos(
           id, user_id, text, start_at, end_at, completed, created_at, updated_at
         ) VALUES ('todo-invalid', 'user-three', '不应提交', 1, 2, 0, 1, 1)`
      ).run();
      return {
        result: { id: "todo-invalid" },
        changes: [{
          entityType: "todos",
          entityId: "todo-invalid",
          operation: "upsert",
          entityVersion: 1,
          payload: { invalid: undefined }
        }]
      };
    }), /不能是 undefined/);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM todos WHERE id = 'todo-invalid'").get().count,
      0
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM replication_operations").get().count,
      0
    );
  });
});

test("replicated service facades capture writes outside HTTP routes", () => {
  withDatabase(({ database }) => {
    createUser(database, "user-internal");
    const unitOfWork = new ReplicationUnitOfWork({
      repository: new ReplicationRepository(database),
      clusterService: new ClusterService(new ClusterRepository(database))
    });
    const todoService = new ReplicatedTodoService(
      new TodoService(new TodoRepository(database)),
      unitOfWork
    );
    const profileService = new ReplicatedProfileService(
      new ProfileService(new ProfileRepository(database)),
      unitOfWork
    );
    const preferenceService = new ReplicatedPreferenceService(
      new PreferenceService(new PreferenceRepository(database)),
      unitOfWork
    );
    const walletService = new ReplicatedWalletService(
      new WalletService(new WalletRepository(database)),
      unitOfWork
    );

    const todo = todoService.create("user-internal", {
      text: "由 AI 创建的待办",
      startAt: 1000,
      endAt: 2000
    });
    const profile = profileService.patch("user-internal", {
      occupation: "独立开发者"
    });
    const preference = preferenceService.save("user-internal", {
      category: "communication",
      key: "tone",
      value: "自然"
    });
    const wallet = walletService.create("user-internal", {
      name: "AI 记录的存款",
      amount: "88.88",
      detail: "聊天记录"
    }, { source: "chat" });

    assert.equal(todo.text, "由 AI 创建的待办");
    assert.equal(profile.occupation, "独立开发者");
    assert.equal(preference.key, "tone");
    assert.equal(wallet.balanceMinor, 8888);
    assert.deepEqual(
      database.prepare(
        `SELECT entity_type, operation FROM replication_operations
         ORDER BY origin_sequence`
      ).all().map((row) => ({ ...row })),
      [
        { entity_type: "todos", operation: "upsert" },
        { entity_type: "user_profiles", operation: "upsert" },
        { entity_type: "user_preferences", operation: "upsert" },
        { entity_type: "wallet_accounts", operation: "upsert" },
        { entity_type: "wallet_transactions", operation: "upsert" }
      ]
    );
    const conversationService = new ReplicatedConversationService(
      new ConversationService(new ConversationRepository(database)),
      unitOfWork
    );
    const conversation = conversationService.create("user-internal", {
      title: "Agent 内部会话"
    });
    conversationService.saveMessages("user-internal", conversation.id, {
      messages: [
        {
          id: "internal-display-message",
          stream: "display",
          position: 0,
          role: "assistant",
          content: "展示内容",
          payload: {},
          createdAt: 100
        },
        {
          id: "internal-model-message",
          stream: "model",
          position: 0,
          role: "assistant",
          content: "模型上下文",
          payload: { tool_calls: [] },
          createdAt: 101
        }
      ]
    });
    const conversationOperations = database.prepare(
      `SELECT entity_type, operation FROM replication_operations
       WHERE entity_type IN ('conversations', 'messages')
       ORDER BY origin_sequence`
    ).all().map((row) => ({ ...row }));
    assert.equal(conversationOperations[0].entity_type, "conversations");
    assert.equal(
      conversationOperations.filter((item) => item.entity_type === "messages").length,
      2
    );
    assert.ok(conversationOperations.every((item) => item.operation === "upsert"));
    assert.equal(
      database.prepare(
        "SELECT COUNT(*) AS count FROM idempotency_requests WHERE request_id LIKE 'internal:%'"
      ).get().count,
      6
    );
  });
});

test("legacy conversation migration reproduces one primary conversation on the peer Hub", () => {
  withDatabase(({ database: sourceDatabase }) => {
    withDatabase(({ database: targetDatabase }) => {
      const userId = "conversation-migration-user";
      createUser(sourceDatabase, userId);
      createUser(targetDatabase, userId);
      seedLegacyConversationState(sourceDatabase, userId);
      seedLegacyConversationState(targetDatabase, userId);
      const repository = new ReplicationRepository(sourceDatabase);
      const clusterService = new ClusterService(new ClusterRepository(sourceDatabase));
      const service = new ReplicatedConversationService(
        new ConversationService(new ConversationRepository(sourceDatabase)),
        new ReplicationUnitOfWork({ repository, clusterService })
      );

      assert.deepEqual(service.list(userId).map((item) => item.id), ["conversation-primary"]);
      const context = clusterService.status(userId);
      const operations = repository.listOperations(
        context.spaceId,
        context.localNodeId,
        0,
        100
      );
      assert.deepEqual(
        operations.map((operation) => `${operation.entityType}:${operation.operation}`),
        [
          "conversations:upsert",
          "messages:upsert",
          "messages:upsert",
          "messages:upsert",
          "memory_evidence:upsert",
          "conversations:delete"
        ]
      );
      service.list(userId);
      assert.equal(
        repository.listOperations(context.spaceId, context.localNodeId, 0, 100).length,
        operations.length
      );

      const applier = new ReplicationEntityApplier(targetDatabase);
      for (const operation of operations) applier.apply(userId, operation);
      assert.deepEqual(
        targetDatabase.prepare(
          "SELECT id FROM conversations WHERE user_id = ? ORDER BY id"
        ).all(userId).map((row) => row.id),
        ["conversation-primary"]
      );
      assert.deepEqual(
        targetDatabase.prepare(
          `SELECT id, conversation_id, stream_type, position
           FROM messages ORDER BY stream_type, position, id`
        ).all().map((row) => ({ ...row })),
        [
          { id: "message-old", conversation_id: "conversation-primary", stream_type: "display", position: 0 },
          { id: "message-primary", conversation_id: "conversation-primary", stream_type: "display", position: 1 },
          { id: "message-model", conversation_id: "conversation-primary", stream_type: "model", position: 0 }
        ]
      );
      assert.equal(
        targetDatabase.prepare(
          "SELECT conversation_id FROM memory_evidence WHERE id = 'evidence-old'"
        ).get().conversation_id,
        "conversation-primary"
      );
    });
  });
});

test("Provider credentials replicate through the Space Key and re-encrypt locally", () => {
  withDatabase(({ database: sourceDatabase, dataDir: sourceDataDir }) => {
    withDatabase(({ database: targetDatabase, dataDir: targetDataDir }) => {
      const userId = "provider-replication-user";
      createUser(sourceDatabase, userId);
      createUser(targetDatabase, userId);
      const sourceSecretBox = createSecretBox(sourceDataDir, "source-master-key");
      const targetSecretBox = createSecretBox(targetDataDir, "target-master-key");
      const sourceClusterService = new ClusterService(
        new ClusterRepository(sourceDatabase)
      );
      const sourceSpaceKeyService = new SpaceKeyService({
        repository: new SpaceKeyRepository(sourceDatabase),
        secretBox: sourceSecretBox
      });
      const sourceReplicationRepository = new ReplicationRepository(sourceDatabase);
      const sourceUnitOfWork = new ReplicationUnitOfWork({
        repository: sourceReplicationRepository,
        clusterService: sourceClusterService,
        spaceKeyService: sourceSpaceKeyService
      });
      const sourceRepository = new AiConfigRepository(
        sourceDatabase,
        sourceSecretBox
      );
      const service = new ReplicatedAiConfigRepository(
        sourceRepository,
        sourceUnitOfWork
      );

      service.save(userId, {
        providerId: "openai",
        providerName: "OpenAI",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-secret-test",
        apiKey: "provider-secret-value"
      });

      const context = sourceClusterService.status(userId);
      const operation = sourceReplicationRepository.listOperations(
        context.spaceId,
        context.localNodeId,
        0,
        10
      )[0];
      const serialized = canonicalStringify(operation.payload);
      assert.equal(operation.entityType, "ai_configs");
      assert.equal(operation.entityId, "config");
      assert.equal(serialized.includes("provider-secret-value"), false);
      assert.equal(Object.hasOwn(operation.payload, "encrypted_api_key"), false);
      assert.equal(operation.payload.credential.algorithm, "A256GCM");

      const sourceSpaceKey = sourceSpaceKeyService.ensure(context.spaceId);
      new ClusterRepository(targetDatabase).createSpace({
        id: context.spaceId,
        userId,
        displayName: userId,
        now: 1
      });
      const targetSpaceKeyService = new SpaceKeyService({
        repository: new SpaceKeyRepository(targetDatabase),
        secretBox: targetSecretBox
      });
      targetSpaceKeyService.import(
        context.spaceId,
        sourceSpaceKey.key.toString("base64")
      );
      const applier = new ReplicationEntityApplier(targetDatabase, {
        secretBox: targetSecretBox,
        spaceKeyService: targetSpaceKeyService
      });
      applier.apply(userId, operation);

      const targetRepository = new AiConfigRepository(
        targetDatabase,
        targetSecretBox
      );
      assert.equal(
        targetRepository.getCredentials(userId).apiKey,
        "provider-secret-value"
      );
      assert.notEqual(
        targetRepository.getStored(userId).encryptedApiKey,
        sourceRepository.getStored(userId).encryptedApiKey
      );

      const tampered = {
        ...operation,
        payload: {
          ...operation.payload,
          credential: {
            ...operation.payload.credential,
            ciphertext: `${operation.payload.credential.ciphertext.slice(0, -4)}AAAA`
          }
        }
      };
      assert.throws(
        () => applier.apply(userId, tampered),
        (error) => error.code === "REPLICATION_SECRET_INVALID"
      );
    });
  });
});

test("prompt history and module settings apply with their logical identities", () => {
  withDatabase(({ database }) => {
    const userId = "settings-apply-user";
    createUser(database, userId);
    const applier = new ReplicationEntityApplier(database);
    const settings = {
      tone: "温柔清晰",
      behaviorRules: ["先理解，再行动"]
    };
    applier.apply(userId, {
      entityType: "prompt_setting_versions",
      entityId: "prompt-version-1",
      operation: "upsert",
      payload: {
        id: "prompt-version-1",
        version: 1,
        settings,
        created_at: 100
      }
    });
    applier.apply(userId, {
      entityType: "prompt_settings",
      entityId: "settings",
      operation: "upsert",
      payload: { version: 1, settings, updated_at: 100 }
    });
    applier.apply(userId, {
      entityType: "module_settings",
      entityId: "todo",
      operation: "upsert",
      payload: { module_id: "todo", enabled: false, updated_at: 101 }
    });
    applier.apply(userId, {
      entityType: "module_settings",
      entityId: "__agent_auto_approve_writes__",
      operation: "upsert",
      payload: {
        module_id: "__agent_auto_approve_writes__",
        enabled: true,
        updated_at: 102
      }
    });

    assert.deepEqual(
      JSON.parse(database.prepare(
        "SELECT settings_json FROM prompt_settings WHERE user_id = ?"
      ).get(userId).settings_json),
      settings
    );
    assert.equal(
      database.prepare(
        "SELECT id FROM prompt_setting_versions WHERE user_id = ? AND version = 1"
      ).get(userId).id,
      "prompt-version-1"
    );
    assert.deepEqual(
      database.prepare(
        `SELECT module_id, enabled FROM module_settings
         WHERE user_id = ? ORDER BY module_id`
      ).all(userId).map((row) => ({ ...row })),
      [
        { module_id: "__agent_auto_approve_writes__", enabled: 1 },
        { module_id: "todo", enabled: 0 }
      ]
    );
  });
});

test("mobile media operations advance metadata safely before the verified blob arrives", () => {
  withDatabase(({ database }) => {
    const userId = "mobile-media-operation-user";
    const mediaId = "mobile-media-1";
    createUser(database, userId);
    const applier = new ReplicationEntityApplier(database);
    const operation = {
      entityType: "media_assets",
      entityId: mediaId,
      operation: "upsert",
      payload: {
        id: mediaId,
        mime_type: "image/webp",
        file_name: `${mediaId}.webp`,
        byte_size: 4096,
        content_hash: "a".repeat(64),
        created_at: 100
      }
    };

    applier.apply(userId, operation);
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM media_assets").get().count,
      0,
      "媒体 Operation 不能绕过 Blob 完整性校验提前创建正式记录"
    );

    database.prepare(
      `INSERT INTO media_assets(
         id, user_id, mime_type, file_name, byte_size, content_hash, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(mediaId, userId, "image/webp", `${mediaId}.webp`, 4096, "a".repeat(64), 100);
    applier.apply(userId, operation);
    assert.throws(
      () => applier.apply(userId, {
        ...operation,
        payload: { ...operation.payload, content_hash: "b".repeat(64) }
      }),
      (error) => error.code === "REPLICATION_MEDIA_IDENTITY_CONFLICT"
    );
  });
});

test("wallet replication rejects a forged balance chain before writing the transaction", () => {
  withDatabase(({ database }) => {
    const userId = "wallet-apply-user";
    createUser(database, userId);
    const applier = new ReplicationEntityApplier(database);
    applier.apply(userId, {
      entityType: "wallet_accounts",
      entityId: "wallet-account-1",
      operation: "upsert",
      payload: {
        id: "wallet-account-1",
        name: "完整性测试存款",
        balance_minor: 10000,
        currency: "CNY",
        note: "",
        created_at: 100,
        updated_at: 100
      }
    });
    const forged = {
      entityType: "wallet_transactions",
      entityId: "wallet-transaction-1",
      operation: "upsert",
      payload: {
        id: "wallet-transaction-1",
        account_id: "wallet-account-1",
        event_type: "deposit",
        change_minor: 500,
        balance_before_minor: 10000,
        balance_after_minor: 10600,
        previous_currency: "CNY",
        currency: "CNY",
        detail: "被篡改的金额链",
        source: "manual",
        created_at: 101
      }
    };
    assert.throws(
      () => applier.apply(userId, forged),
      (error) => error.code === "REPLICATION_PAYLOAD_INVALID" &&
        error.details.field === "change_minor"
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM wallet_transactions").get().count,
      0
    );
    applier.apply(userId, {
      ...forged,
      payload: { ...forged.payload, balance_after_minor: 10500 }
    });
    assert.equal(
      database.prepare(
        "SELECT balance_after_minor FROM wallet_transactions WHERE id = ?"
      ).get("wallet-transaction-1").balance_after_minor,
      10500
    );
  });
});

test("replication deletes use the signed entity id when the payload is empty", () => {
  withDatabase(({ database }) => {
    const userId = "delete-payload-user";
    createUser(database, userId);
    const conversations = new ConversationService(new ConversationRepository(database));
    const conversation = conversations.create(userId, { title: "待删除会话" });
    conversations.saveMessages(userId, conversation.id, {
      messages: [{
        id: "delete-payload-message",
        stream: "display",
        position: 0,
        role: "assistant",
        content: "待删除消息",
        payload: {},
        createdAt: 100
      }]
    });
    const applier = new ReplicationEntityApplier(database);

    applier.apply(userId, {
      entityType: "messages",
      entityId: "delete-payload-message",
      operation: "delete",
      payload: {}
    });
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM messages WHERE id = ?")
        .get("delete-payload-message").count,
      0
    );

    applier.apply(userId, {
      entityType: "conversations",
      entityId: conversation.id,
      operation: "delete",
      payload: {}
    });
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM conversations WHERE id = ?")
        .get(conversation.id).count,
      0
    );

    assert.throws(
      () => applier.apply(userId, {
        entityType: "todos",
        entityId: "expected-id",
        operation: "delete",
        payload: { id: "forged-id" }
      }),
      (error) => error.code === "REPLICATION_PAYLOAD_INVALID" && error.details.field === "id"
    );
  });
});

test("long-term memory and assistant identity operations reproduce the same state", () => {
  withDatabase(({ database: sourceDatabase }) => {
    withDatabase(({ database: targetDatabase }) => {
      const userId = "memory-replication-user";
      createUser(sourceDatabase, userId);
      createUser(targetDatabase, userId);
      const repository = new ReplicationRepository(sourceDatabase);
      const clusterService = new ClusterService(new ClusterRepository(sourceDatabase), {
        nodeName: "source-memory-hub"
      });
      const unitOfWork = new ReplicationUnitOfWork({ repository, clusterService });
      const evidenceRepository = new MemoryEvidenceRepository(sourceDatabase);
      const memoryService = new ReplicatedMemoryService(
        new MemoryService(new MemoryRepository(sourceDatabase)),
        unitOfWork,
        evidenceRepository
      );
      const replicatedEvidence = new ReplicatedMemoryEvidenceRepository(
        evidenceRepository,
        unitOfWork
      );
      const settingsService = new ReplicatedMemorySettingsService(
        new MemorySettingsService(new MemorySettingsRepository(sourceDatabase)),
        unitOfWork
      );
      const assistantService = new ReplicatedAssistantMemoryService(
        new AssistantMemoryService(new AssistantMemoryRepository(sourceDatabase)),
        unitOfWork
      );

      const memory = memoryService.create(userId, {
        domain: "life",
        type: "fact",
        content: "用户希望两个 Hub 都保留完整的长期记忆。",
        entities: ["双 Hub", "长期记忆"],
        source: "explicit",
        sourceExcerpt: "两个 Hub 都要记得",
        memoryKey: "dual-hub-memory",
        importance: 0.9
      });
      replicatedEvidence.add(userId, memory.id, {
        conversationId: "conversation-memory-1",
        evidence: "用户明确要求在切换 Hub 后仍然记得。",
        confidence: 0.95
      });
      settingsService.save(userId, { autoConfirm: true, autoConfirmAll: false });
      assistantService.saveProfile(userId, {
        name: "小玄",
        relationshipSummary: "洛尼亲密可靠的数字伙伴",
        traits: [{ key: "tone", value: "自然亲昵" }],
        values: [{ key: "integrity", value: "重视数据完整性" }]
      });
      assistantService.recordEvent(userId, {
        category: "growth",
        traitKey: "carefulness",
        traitValue: "切换 Hub 前先完成一致性校验",
        content: "在跨 Hub 切换时变得更谨慎。",
        evidence: "双 Hub 实现约束",
        sourceRole: "shared",
        confidence: 0.9,
        weight: 0.8,
        status: "active"
      });
      assistantService.createSharedMemory(userId, {
        type: "milestone",
        content: "我们一起完成了双 Hub 的长期记忆复制。",
        participants: ["洛尼", "小玄"],
        evidence: "实现与验证记录",
        source: "explicit",
        confidence: 1,
        importance: 0.95,
        status: "active"
      });

      const cluster = clusterService.status(userId);
      const operations = repository.listOperations(
        cluster.spaceId,
        cluster.localNodeId,
        0,
        100
      );
      const entityTypes = operations.map((operation) => operation.entityType);
      assert.ok(entityTypes.includes("memories"));
      assert.ok(entityTypes.includes("memory_evidence"));
      assert.ok(entityTypes.includes("memory_settings"));
      assert.ok(entityTypes.includes("assistant_profiles"));
      assert.ok(entityTypes.includes("assistant_personality_events"));
      assert.ok(entityTypes.includes("shared_memories"));

      const applier = new ReplicationEntityApplier(targetDatabase);
      for (const operation of operations) applier.apply(userId, operation);

      assert.deepEqual(
        rowsForReplicationComparison(targetDatabase, "memories", userId),
        rowsForReplicationComparison(sourceDatabase, "memories", userId)
      );
      assert.deepEqual(
        rowsForReplicationComparison(targetDatabase, "memory_evidence", userId),
        rowsForReplicationComparison(sourceDatabase, "memory_evidence", userId)
      );
      assert.deepEqual(
        rowsForReplicationComparison(targetDatabase, "memory_settings", userId),
        rowsForReplicationComparison(sourceDatabase, "memory_settings", userId)
      );
      assert.deepEqual(
        rowsForReplicationComparison(targetDatabase, "assistant_profiles", userId),
        rowsForReplicationComparison(sourceDatabase, "assistant_profiles", userId)
      );
      assert.deepEqual(
        rowsForReplicationComparison(targetDatabase, "assistant_personality_events", userId),
        rowsForReplicationComparison(sourceDatabase, "assistant_personality_events", userId)
      );
      assert.deepEqual(
        rowsForReplicationComparison(targetDatabase, "shared_memories", userId),
        rowsForReplicationComparison(sourceDatabase, "shared_memories", userId)
      );
    });
  });
});

test("memory evidence replication rejects an orphan before writing data", () => {
  withDatabase(({ database }) => {
    const userId = "orphan-evidence-user";
    createUser(database, userId);
    const applier = new ReplicationEntityApplier(database);
    assert.throws(
      () => applier.apply(userId, {
        entityType: "memory_evidence",
        entityId: "orphan-evidence",
        operation: "upsert",
        payload: {
          id: "orphan-evidence",
          memory_id: "missing-memory",
          conversation_id: "conversation-1",
          evidence: "不能脱离长期记忆单独存在",
          evidence_hash: "a".repeat(64),
          confidence: 0.8,
          created_at: 100
        }
      }),
      (error) => error.code === "REPLICATION_MEMORY_MISSING"
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM memory_evidence").get().count,
      0
    );
  });
});

test("journals and mood state reproduce exactly on the standby Hub", async () => {
  await withDatabaseAsync(async ({ database: sourceDatabase }) => {
    await withDatabaseAsync(async ({ database: targetDatabase }) => {
      const userId = "life-state-replication-user";
      createUser(sourceDatabase, userId);
      createUser(targetDatabase, userId);
      const repository = new ReplicationRepository(sourceDatabase);
      const clusterService = new ClusterService(new ClusterRepository(sourceDatabase), {
        nodeName: "source-life-state-hub"
      });
      const unitOfWork = new ReplicationUnitOfWork({ repository, clusterService });
      const journalService = new ReplicatedJournalService(
        new JournalService(new JournalRepository(sourceDatabase)),
        unitOfWork
      );
      const moodService = new ReplicatedXuanMoodService(
        new XuanMoodService({
          repository: new XuanMoodRepository(sourceDatabase),
          configRepository: { getCredentials: () => ({ apiKey: "test" }) },
          providerClient: {
            chat: async () => ({
              ok: true,
              data: {
                choices: [{
                  message: {
                    content: JSON.stringify({
                      event: {
                        summary: "完成了生命状态复制",
                        emotionalTone: "安稳而开心",
                        effectOnXuan: "更安心地继续生长",
                        intensity: "medium"
                      },
                      state: {
                        currentMood: "安心",
                        energy: "平稳",
                        attention: "双 Hub 的连续性"
                      },
                      display: {
                        title: "安心生长",
                        line: "她的状态也完整留在两个 Hub 里。",
                        detail: "切换节点不会打断这份连续感。",
                        focus: "数据连续性",
                        tone: "calm",
                        expiresInMinutes: 30
                      }
                    })
                  }
                }]
              }
            })
          }
        }),
        unitOfWork
      );

      journalService.save(userId, {
        type: "daily",
        periodKey: "2026-07-30",
        title: "双 Hub 继续生长",
        content: "今天把长期记忆和生命状态接进了复制链。",
        mood: "安心",
        sourceFrom: 1000,
        sourceTo: 2000,
        sourceMessageCount: 2
      });
      await moodService.recordEvent(userId, {
        sourceType: "journal",
        sourceId: "journal-source-1",
        sourceCreatedAt: 2000,
        title: "双 Hub 继续生长",
        content: "生命状态也会跟着她一起过去。",
        mood: "安心"
      });

      const cluster = clusterService.status(userId);
      const operations = repository.listOperations(
        cluster.spaceId,
        cluster.localNodeId,
        0,
        100
      );
      assert.deepEqual(
        new Set(operations.map((operation) => operation.entityType)),
        new Set([
          "assistant_journals",
          "xuan_mood_events",
          "xuan_mood_state",
          "xuan_mood_displays"
        ])
      );
      const applier = new ReplicationEntityApplier(targetDatabase);
      for (const operation of operations) applier.apply(userId, operation);

      for (const table of [
        "assistant_journals",
        "xuan_mood_events",
        "xuan_mood_state",
        "xuan_mood_displays"
      ]) {
        assert.deepEqual(
          rowsForReplicationComparison(targetDatabase, table, userId),
          rowsForReplicationComparison(sourceDatabase, table, userId)
        );
      }
    });
  });
});

test("album and dream cards preserve parent-source relationships across Hubs", () => {
  withDatabase(({ database: sourceDatabase }) => {
    withDatabase(({ database: targetDatabase }) => {
      const userId = "creative-record-replication-user";
      createUser(sourceDatabase, userId);
      createUser(targetDatabase, userId);
      const repository = new ReplicationRepository(sourceDatabase);
      const clusterService = new ClusterService(new ClusterRepository(sourceDatabase), {
        nodeName: "source-creative-hub"
      });
      const unitOfWork = new ReplicationUnitOfWork({ repository, clusterService });
      const albumService = new ReplicatedAlbumService(
        new AlbumService(new AlbumRepository(sourceDatabase)),
        unitOfWork
      );
      const dreamService = new ReplicatedDreamService(
        new DreamService(new DreamRepository(sourceDatabase)),
        unitOfWork
      );

      const moment = albumService.createMoment(userId, {
        occurredAt: 3000,
        title: "一起完善双 Hub",
        summary: "用户和助手把纪念册也接进了复制链。",
        detail: "所有来源都保留自己的实体身份。",
        mood: "踏实",
        tags: ["双 Hub", "里程碑"],
        importance: 0.9,
        sources: [{
          sourceType: "manual",
          sourceId: "album-source-1",
          sourceExcerpt: "第一次来源说明",
          weight: 0.8
        }]
      });
      albumService.addSource(userId, moment.id, {
        sourceType: "manual",
        sourceId: "album-source-1",
        sourceExcerpt: "更新后的来源说明",
        weight: 0.9
      });
      const dream = dreamService.createDream(userId, {
        dreamDate: "2026-07-30",
        title: "两座会呼吸的灯塔",
        content: "两座灯塔隔着夜色交换完整的记忆。",
        mood: "安静",
        symbols: ["灯塔", "数据流"],
        sourceFrom: 1000,
        sourceTo: 4000,
        sources: [{
          sourceType: "manual",
          sourceId: "dream-source-1",
          sourceExcerpt: "双 Hub 的联想",
          weight: 0.85
        }]
      });
      dreamService.addSource(userId, dream.id, {
        sourceType: "manual",
        sourceId: "dream-source-1",
        sourceExcerpt: "更新后的梦境来源",
        weight: 0.95
      });

      const cluster = clusterService.status(userId);
      const operations = repository.listOperations(
        cluster.spaceId,
        cluster.localNodeId,
        0,
        100
      );
      assert.deepEqual(
        new Set(operations.map((operation) => operation.entityType)),
        new Set([
          "album_moments",
          "album_moment_sources",
          "assistant_dreams",
          "assistant_dream_sources"
        ])
      );
      const applier = new ReplicationEntityApplier(targetDatabase);
      for (const operation of operations) applier.apply(userId, operation);
      for (const table of [
        "album_moments",
        "album_moment_sources",
        "assistant_dreams",
        "assistant_dream_sources"
      ]) {
        assert.deepEqual(
          rowsForReplicationComparison(targetDatabase, table, userId),
          rowsForReplicationComparison(sourceDatabase, table, userId)
        );
      }
    });
  });
});

test("paired test Hubs negotiate hello, pull continuous operations and persist acknowledgements", () => {
  withDatabase(({ database: desktopDatabase }) => {
    withDatabase(({ database: mobileDatabase }) => {
      const userId = "paired-user";
      const spaceId = "space-paired";
      const desktopNodeId = "node-desktop";
      const mobileNodeId = "node-mobile";
      createUser(desktopDatabase, userId);
      createUser(mobileDatabase, userId);
      seedPairedCluster(desktopDatabase, {
        userId,
        spaceId,
        localNodeId: desktopNodeId,
        desktopNodeId,
        mobileNodeId
      });
      seedPairedCluster(mobileDatabase, {
        userId,
        spaceId,
        localNodeId: mobileNodeId,
        desktopNodeId,
        mobileNodeId
      });

      const desktop = peerFixture(desktopDatabase);
      const mobile = peerFixture(mobileDatabase);
      const desktopHello = desktop.peerService.describeForUser(userId);
      const mobileHello = mobile.peerService.describeForUser(userId);
      assert.equal(desktop.peerService.hello(userId, mobileHello).peerNodeId, mobileNodeId);
      assert.equal(mobile.peerService.hello(userId, desktopHello).peerNodeId, desktopNodeId);

      const todoService = new ReplicatedTodoService(
        new TodoService(new TodoRepository(desktopDatabase)),
        desktop.unitOfWork
      );
      todoService.create(userId, {
        text: "同步到手机 Hub",
        startAt: 1000,
        endAt: 2000
      });
      const pulled = desktop.peerService.pull(userId, {
        originNodeId: desktopNodeId,
        after: 0,
        limit: 1
      });
      assert.equal(pulled.operations.length, 1);
      assert.equal(pulled.operations[0].originSequence, 1);
      assert.equal(pulled.nextAfter, 1);
      assert.equal(pulled.headSequence, 1);
      assert.equal(pulled.hasMore, false);

      const acknowledged = desktop.peerService.acknowledge(userId, mobileNodeId, [{
        originNodeId: desktopNodeId,
        contiguousSequence: 1,
        operationHash: pulled.operations[0].operationHash
      }]);
      assert.equal(acknowledged.acknowledgements[0].contiguousSequence, 1);
      assert.equal(
        desktopDatabase.prepare(
          `SELECT contiguous_sequence FROM replication_watermarks
           WHERE space_id = ? AND peer_node_id = ? AND origin_node_id = ?`
        ).get(spaceId, mobileNodeId, desktopNodeId).contiguous_sequence,
        1
      );
      assert.throws(
        () => desktop.peerService.acknowledge(userId, mobileNodeId, [{
          originNodeId: desktopNodeId,
          contiguousSequence: 1,
          operationHash: "invalid"
        }]),
        (error) => error.code === "PEER_ACK_HASH_MISMATCH"
      );

      assert.throws(
        () => desktop.peerService.confirmSync(userId, mobileNodeId, {
          originNodeId: desktopNodeId,
          originSequence: 1,
          operationHash: "invalid"
        }),
        (error) => error.code === "PEER_SYNC_PROOF_MISMATCH"
      );
      const confirmed = desktop.peerService.confirmSync(userId, mobileNodeId, {
        originNodeId: desktopNodeId,
        originSequence: 1,
        operationHash: pulled.operations[0].operationHash
      });
      assert.equal(confirmed.caughtUp, true);
      assert.equal(confirmed.localSequence, 1);
      assert.equal(confirmed.remoteSequence, 1);
      const mobileHub = desktop.clusterService.mobileHubs(userId)[0];
      assert.equal(mobileHub.replication.caughtUp, true);
      assert.equal(mobileHub.replication.lastSuccessAt, confirmed.lastSuccessAt);
    });
  });
});

test("space keys sign operations and peer credentials reject tampering and replay", () => {
  withDatabase(({ database, dataDir }) => {
    const userId = "authenticated-peer-user";
    const spaceId = "space-authenticated";
    const desktopNodeId = "node-auth-desktop";
    const mobileNodeId = "node-auth-mobile";
    createUser(database, userId);
    seedPairedCluster(database, {
      userId,
      spaceId,
      localNodeId: desktopNodeId,
      desktopNodeId,
      mobileNodeId
    });
    const clusterRepository = new ClusterRepository(database);
    const clusterService = new ClusterService(clusterRepository);
    const replicationRepository = new ReplicationRepository(database);
    const secretBox = createSecretBox(dataDir, "peer-auth-test-master-key");
    const spaceKeyService = new SpaceKeyService({
      repository: new SpaceKeyRepository(database),
      secretBox,
      now: () => 1780000000000
    });
    const unitOfWork = new ReplicationUnitOfWork({
      repository: replicationRepository,
      clusterService,
      spaceKeyService,
      now: () => 1780000000001
    });
    const todoService = new ReplicatedTodoService(
      new TodoService(new TodoRepository(database)),
      unitOfWork
    );
    todoService.create(userId, {
      text: "带认证标签的待办",
      startAt: 1000,
      endAt: 2000
    });
    const operation = database.prepare(
      "SELECT authentication_tag FROM replication_operations LIMIT 1"
    ).get();
    assert.match(operation.authentication_tag, /^[a-f0-9]{64}$/);
    const storedSpaceKey = database.prepare(
      "SELECT encrypted_sync_key FROM space_data_keys WHERE space_id = ?"
    ).get(spaceId).encrypted_sync_key;
    assert.match(storedSpaceKey, /^v1\./);

    const now = 1780000001000;
    const authentication = new PeerAuthenticationService({
      repository: new PeerCredentialRepository(database),
      clusterService,
      clusterRepository,
      secretBox,
      now: () => now
    });
    const credential = authentication.issueCredential(
      userId,
      mobileNodeId,
      Buffer.alloc(32, 7).toString("base64")
    );
    const request = {
      spaceId,
      nodeId: mobileNodeId,
      keyId: credential.keyId,
      method: "POST",
      path: "/api/v1/peer/hello",
      timestamp: now,
      nonce: "peer-request-nonce-0001",
      body: { nodeId: mobileNodeId, epoch: 1 }
    };
    const headers = createPeerRequestHeaders(request, credential.sharedSecret);
    assert.equal(
      authentication.verify(userId, { ...request, headers }).peerNodeId,
      mobileNodeId
    );
    assert.throws(
      () => authentication.verify(userId, { ...request, headers }),
      (error) => error.code === "PEER_REQUEST_REPLAYED"
    );

    const tampered = {
      ...request,
      nonce: "peer-request-nonce-0002",
      body: { nodeId: mobileNodeId, epoch: 2 }
    };
    assert.throws(
      () => authentication.verify(userId, {
        ...tampered,
        headers: {
          ...headers,
          "X-AetherX-Peer-Nonce": tampered.nonce
        }
      }),
      (error) => error.code === "PEER_AUTH_INVALID"
    );
    assert.equal(
      database.prepare("SELECT COUNT(*) AS count FROM peer_request_nonces").get().count,
      1
    );
    const storedCredential = database.prepare(
      "SELECT encrypted_shared_secret FROM hub_peer_credentials WHERE space_id = ?"
    ).get(spaceId).encrypted_shared_secret;
    assert.match(storedCredential, /^v1\./);
    assert.equal(storedCredential.includes(credential.sharedSecret), false);
  });
});

test("standby Hub applies authenticated pilot entities atomically and rejects gaps", () => {
  withDatabase(({ database: desktopDatabase, dataDir: desktopDataDir }) => {
    withDatabase(({ database: mobileDatabase, dataDir: mobileDataDir }) => {
      const userId = "apply-user";
      const spaceId = "space-apply";
      const desktopNodeId = "node-apply-desktop";
      const mobileNodeId = "node-apply-mobile";
      const syncKey = Buffer.alloc(32, 9).toString("base64");
      for (const database of [desktopDatabase, mobileDatabase]) createUser(database, userId);
      seedPairedCluster(desktopDatabase, {
        userId,
        spaceId,
        localNodeId: desktopNodeId,
        desktopNodeId,
        mobileNodeId
      });
      seedPairedCluster(mobileDatabase, {
        userId,
        spaceId,
        localNodeId: mobileNodeId,
        desktopNodeId,
        mobileNodeId
      });

      const desktopClusterRepository = new ClusterRepository(desktopDatabase);
      const desktopClusterService = new ClusterService(desktopClusterRepository);
      const desktopReplicationRepository = new ReplicationRepository(desktopDatabase);
      const desktopSpaceKeyService = new SpaceKeyService({
        repository: new SpaceKeyRepository(desktopDatabase),
        secretBox: createSecretBox(desktopDataDir, "desktop-space-key")
      });
      desktopSpaceKeyService.import(spaceId, syncKey);
      const desktopUnitOfWork = new ReplicationUnitOfWork({
        repository: desktopReplicationRepository,
        clusterService: desktopClusterService,
        spaceKeyService: desktopSpaceKeyService
      });
      const todoService = new ReplicatedTodoService(
        new TodoService(new TodoRepository(desktopDatabase)),
        desktopUnitOfWork
      );
      const profileService = new ReplicatedProfileService(
        new ProfileService(new ProfileRepository(desktopDatabase)),
        desktopUnitOfWork
      );
      const preferenceService = new ReplicatedPreferenceService(
        new PreferenceService(new PreferenceRepository(desktopDatabase)),
        desktopUnitOfWork
      );
      const todo = todoService.create(userId, {
        text: "复制到备用 Hub",
        startAt: 1000,
        endAt: 2000
      });
      profileService.patch(userId, { occupation: "独立开发者" });
      const preference = preferenceService.save(userId, {
        category: "communication",
        key: "tone",
        value: "自然亲密"
      });
      const desktopPeerService = new PeerReplicationService({
        repository: desktopReplicationRepository,
        clusterService: desktopClusterService,
        clusterRepository: desktopClusterRepository
      });
      const initialBatch = desktopPeerService.pull(userId, {
        originNodeId: desktopNodeId,
        after: 0
      }).operations;
      assert.equal(initialBatch.length, 3);

      const mobileClusterRepository = new ClusterRepository(mobileDatabase);
      const mobileClusterService = new ClusterService(mobileClusterRepository);
      const mobileReplicationRepository = new ReplicationRepository(mobileDatabase);
      const mobileSpaceKeyService = new SpaceKeyService({
        repository: new SpaceKeyRepository(mobileDatabase),
        secretBox: createSecretBox(mobileDataDir, "mobile-space-key")
      });
      mobileSpaceKeyService.import(spaceId, syncKey);
      const applyService = new ReplicationApplyService({
        repository: mobileReplicationRepository,
        clusterService: mobileClusterService,
        clusterRepository: mobileClusterRepository,
        spaceKeyService: mobileSpaceKeyService,
        entityApplier: new ReplicationEntityApplier(mobileDatabase)
      });

      const applied = applyService.apply(userId, desktopNodeId, initialBatch);
      assert.equal(applied.applied, 3);
      assert.equal(applied.skipped, 0);
      assert.equal(
        mobileDatabase.prepare("SELECT text FROM todos WHERE id = ?").get(todo.id).text,
        "复制到备用 Hub"
      );
      assert.equal(
        mobileDatabase.prepare("SELECT occupation FROM user_profiles WHERE user_id = ?")
          .get(userId).occupation,
        "独立开发者"
      );
      assert.equal(
        JSON.parse(
          mobileDatabase.prepare("SELECT value_json FROM user_preferences WHERE id = ?")
            .get(preference.id).value_json
        ),
        "自然亲密"
      );
      const repeated = applyService.apply(userId, desktopNodeId, initialBatch);
      assert.equal(repeated.applied, 0);
      assert.equal(repeated.skipped, 3);

      todoService.update(userId, todo.id, { completed: true });
      profileService.patch(userId, { occupation: "产品创造者" });
      const laterBatch = desktopPeerService.pull(userId, {
        originNodeId: desktopNodeId,
        after: 3
      }).operations;
      assert.equal(laterBatch.length, 2);
      const tampered = {
        ...laterBatch[1],
        payload: { ...laterBatch[1].payload, occupation: "被篡改" }
      };
      assert.throws(
        () => applyService.apply(userId, desktopNodeId, [laterBatch[0], tampered]),
        (error) => error.code === "REPLICATION_OPERATION_INVALID"
      );
      assert.throws(
        () => applyService.apply(userId, desktopNodeId, [laterBatch[1]]),
        (error) => error.code === "REPLICATION_SEQUENCE_GAP"
      );
      assert.equal(
        mobileDatabase.prepare("SELECT completed FROM todos WHERE id = ?").get(todo.id).completed,
        0
      );

      const laterApplied = applyService.apply(userId, desktopNodeId, laterBatch);
      assert.equal(laterApplied.applied, 2);
      assert.equal(
        mobileDatabase.prepare("SELECT completed FROM todos WHERE id = ?").get(todo.id).completed,
        1
      );
      assert.equal(
        mobileDatabase.prepare("SELECT occupation FROM user_profiles WHERE user_id = ?")
          .get(userId).occupation,
        "产品创造者"
      );
      assert.equal(
        mobileDatabase.prepare("SELECT COUNT(*) AS count FROM applied_operations").get().count,
        5
      );
    });
  });
});

function seedLegacyConversationState(database, userId) {
  database.prepare(
    `INSERT INTO conversations(id, user_id, title, summary, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?)`
  ).run("conversation-old", userId, "Old", 1, 100);
  database.prepare(
    `INSERT INTO conversations(id, user_id, title, summary, created_at, updated_at)
     VALUES (?, ?, ?, '', ?, ?)`
  ).run("conversation-primary", userId, "Primary", 2, 200);
  const insertMessage = database.prepare(
    `INSERT INTO messages(
       id, conversation_id, stream_type, position, role, content, payload_json, created_at
     ) VALUES (?, ?, ?, ?, 'assistant', ?, '{}', ?)`
  );
  insertMessage.run("message-old", "conversation-old", "display", 7, "old", 10);
  insertMessage.run("message-primary", "conversation-primary", "display", 9, "primary", 20);
  insertMessage.run("message-model", "conversation-old", "model", 5, "model", 15);
  database.prepare(
    `INSERT INTO memories(
       id, user_id, domain, memory_type, content, source, confidence,
       importance, sensitivity, status, created_at, updated_at
     ) VALUES ('memory-old', ?, 'life', 'fact', 'legacy evidence', 'explicit', 1, 1,
               'normal', 'active', 1, 1)`
  ).run(userId);
  database.prepare(
    `INSERT INTO memory_evidence(
       id, user_id, memory_id, conversation_id, evidence, evidence_hash,
       confidence, created_at
     ) VALUES ('evidence-old', ?, 'memory-old', 'conversation-old',
               'legacy evidence', ?, 1, 1)`
  ).run(userId, "b".repeat(64));
}

function withDatabase(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-replication-"));
  const database = openDatabase(dataDir);
  try {
    run({ database, dataDir });
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

async function withDatabaseAsync(run) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-replication-"));
  const database = openDatabase(dataDir);
  try {
    await run({ database, dataDir });
  } finally {
    database.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

function createUser(database, id) {
  database.prepare(
    `INSERT INTO users(id, username, display_name, password_hash, created_at, updated_at)
     VALUES (?, ?, ?, 'test-password-hash', 1, 1)`
  ).run(id, id, id);
}

function rowsForReplicationComparison(database, table, userId) {
  return database.prepare(
    `SELECT * FROM ${table} WHERE user_id = ? ORDER BY rowid`
  ).all(userId).map((row) => ({ ...row }));
}

function peerFixture(database) {
  const clusterRepository = new ClusterRepository(database);
  const healthRepository = new ReplicationHealthRepository(database);
  const clusterService = new ClusterService(clusterRepository, {
    replicationHealthProvider: (spaceId, nodeId) =>
      healthRepository.find(spaceId, nodeId)
  });
  const replicationRepository = new ReplicationRepository(database);
  return {
    clusterService,
    healthRepository,
    unitOfWork: new ReplicationUnitOfWork({
      repository: replicationRepository,
      clusterService
    }),
    peerService: new PeerReplicationService({
      repository: replicationRepository,
      clusterService,
      clusterRepository,
      healthRepository
    })
  };
}

function seedPairedCluster(database, input) {
  const now = 1780000000000;
  const schemaVersion = Number(
    database.prepare("SELECT MAX(version) AS version FROM schema_migrations").get().version
  );
  database.prepare(
    `INSERT INTO hub_instance(
       singleton, node_id, node_name, platform, public_identity,
       protocol_version, schema_version, created_at, updated_at
     ) VALUES (1, ?, ?, ?, ?, 1, ?, ?, ?)`
  ).run(
    input.localNodeId,
    input.localNodeId === input.desktopNodeId ? "桌面测试 Hub" : "手机测试 Hub",
    input.localNodeId === input.desktopNodeId ? "win32" : "android",
    `identity:${input.localNodeId}`,
    schemaVersion,
    now,
    now
  );
  database.prepare(
    `INSERT INTO aetherx_spaces(id, local_user_id, display_name, created_at, updated_at)
     VALUES (?, ?, '测试空间', ?, ?)`
  ).run(input.spaceId, input.userId, now, now);
  const insertNode = database.prepare(
    `INSERT INTO hub_nodes(
       id, space_id, node_name, platform, public_identity, protocol_version,
       schema_version, status, last_seen_at, created_at, revoked_at
     ) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, NULL)`
  );
  insertNode.run(
    input.desktopNodeId,
    input.spaceId,
    "桌面测试 Hub",
    "win32",
    `identity:${input.desktopNodeId}`,
    schemaVersion,
    "active",
    now,
    now
  );
  insertNode.run(
    input.mobileNodeId,
    input.spaceId,
    "手机测试 Hub",
    "android",
    `identity:${input.mobileNodeId}`,
    schemaVersion,
    "standby",
    now,
    now
  );
  const state = {
    spaceId: input.spaceId,
    epoch: 1,
    activeNodeId: input.desktopNodeId,
    transitionId: "",
    state: "stable"
  };
  database.prepare(
    `INSERT INTO hub_cluster_state(
       space_id, epoch, active_node_id, transition_id, state, state_hash,
       control_signature, updated_at
     ) VALUES (?, 1, ?, '', 'stable', ?, '', ?)`
  ).run(input.spaceId, input.desktopNodeId, sha256Canonical(state), now);
}
