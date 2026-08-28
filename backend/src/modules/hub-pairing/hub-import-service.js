const { HttpError } = require("../../lib/http-error");
const { sha256Canonical } = require("../replication/operation-codec");
const { CLUSTER_PROTOCOL_VERSION } = require("../hub-cluster/cluster-service");
const { isPristineAccountProfile } = require("../auth/account-defaults");
const {
  normalizeHubEndpoints,
  unwrapHubPairingEnvelope
} = require("./hub-pairing-service");

const LOCAL_TABLES = new Set([
  "auth_sessions",
  "device_pairing_sessions",
  "hub_pairing_sessions",
  "mobile_client_health",
  "paired_devices",
  "schema_migrations",
  "sync_changes",
  "users"
]);

class HubImportService {
  constructor({
    database,
    clusterRepository,
    endpointRepository,
    clusterService,
    peerAuthenticationService,
    spaceKeyService,
    now = () => Date.now()
  }) {
    this.database = database;
    this.clusterRepository = clusterRepository;
    this.endpointRepository = endpointRepository;
    this.clusterService = clusterService;
    this.peerAuthenticationService = peerAuthenticationService;
    this.spaceKeyService = spaceKeyService;
    this.now = now;
  }

  import(userId, input = {}) {
    let payload;
    try {
      payload = unwrapHubPairingEnvelope(
        input.envelope,
        input.clientEphemeralPrivateKey
      );
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(400, "HUB_PAIRING_ENVELOPE_INVALID", "Hub 配对密钥包无法解密。");
    }
    const normalized = normalizePayload(payload);
    const schemaVersion = this.clusterRepository.schemaVersion();
    if (normalized.protocolVersion !== CLUSTER_PROTOCOL_VERSION) {
      throw new HttpError(409, "HUB_IMPORT_PROTOCOL_INCOMPATIBLE", "Hub 复制协议版本不兼容。");
    }
    if (normalized.schemaVersion !== schemaVersion) {
      throw new HttpError(409, "HUB_IMPORT_SCHEMA_INCOMPATIBLE", "Hub 数据库版本不兼容。");
    }
    return this.clusterRepository.transaction(() => {
      this.prepareLocalIdentity(userId, normalized, schemaVersion);
      this.prepareSpace(userId, normalized);
      this.prepareEndpoints(normalized);
      this.spaceKeyService.import(normalized.spaceId, normalized.spaceSyncKey);
      this.peerAuthenticationService.importCredential(
        userId,
        normalized.peerNodeId,
        normalized.peerCredential.keyId,
        normalized.peerCredential.sharedSecret
      );
      const context = this.clusterService.ensureSpace(userId);
      return {
        imported: true,
        spaceId: context.space_id,
        localNodeId: context.local_node_id,
        activeNodeId: context.active_node_id,
        epoch: Number(context.epoch),
        state: context.state,
        localRole: context.local_node_id === context.active_node_id ? "active" : "standby",
        bootstrapRequired: true
      };
    });
  }

  prepareLocalIdentity(userId, payload, schemaVersion) {
    const localNode = payload.nodes.find((node) => node.id === payload.localNodeId);
    const instance = this.clusterRepository.findLocalInstance();
    if (instance && instance.node_id !== payload.localNodeId) {
      throw new HttpError(
        409,
        "HUB_IMPORT_LOCAL_IDENTITY_CONFLICT",
        "密钥包中的目标节点与本机 Hub 身份不一致。"
      );
    }
    if (!instance) {
      this.clusterRepository.createLocalInstance({
        nodeId: localNode.id,
        nodeName: localNode.name,
        platform: localNode.platform,
        publicIdentity: localNode.publicIdentity,
        protocolVersion: payload.protocolVersion,
        schemaVersion,
        now: this.now()
      });
      return;
    }
    this.clusterRepository.updateLocalInstanceIdentity({
      nodeId: localNode.id,
      nodeName: localNode.name,
      platform: localNode.platform,
      publicIdentity: localNode.publicIdentity,
      protocolVersion: payload.protocolVersion,
      schemaVersion,
      now: this.now()
    });
  }

  prepareSpace(userId, payload) {
    const existing = this.clusterRepository.findSpaceByUserId(userId);
    if (existing?.id === payload.spaceId) {
      const context = this.clusterRepository.findContextByUserId(userId);
      if (
        !context ||
        context.active_node_id !== payload.activeNodeId ||
        Number(context.epoch) !== payload.epoch
      ) {
        throw new HttpError(409, "HUB_IMPORT_CLUSTER_CONFLICT", "本地已存在不同的集群状态。");
      }
      return;
    }
    if (existing) {
      this.assertProvisionalSpaceIsEmpty(userId, existing.id);
      this.clusterRepository.deleteSpaceForUser(userId);
    }
    this.clusterRepository.createSpace({
      id: payload.spaceId,
      userId,
      displayName: payload.space.displayName,
      now: payload.space.createdAt
    });
    for (const node of payload.nodes) {
      this.clusterRepository.createNode({
        id: node.id,
        spaceId: payload.spaceId,
        nodeName: node.name,
        platform: node.platform,
        publicIdentity: node.publicIdentity,
        protocolVersion: node.protocolVersion,
        schemaVersion: node.schemaVersion,
        status: node.status,
        now: this.now(),
        lastSeenAt: node.lastSeenAt,
        createdAt: node.createdAt,
        revokedAt: node.revokedAt
      });
    }
    this.clusterRepository.createClusterState({
      spaceId: payload.spaceId,
      epoch: payload.clusterState.epoch,
      activeNodeId: payload.clusterState.activeNodeId,
      transitionId: payload.clusterState.transitionId,
      state: payload.clusterState.state,
      stateHash: payload.clusterState.stateHash,
      controlSignature: payload.clusterState.controlSignature,
      now: payload.clusterState.updatedAt
    });
  }

  prepareEndpoints(payload) {
    for (const node of payload.nodes) {
      this.endpointRepository.replaceNodeEndpoints(
        payload.spaceId,
        node.id,
        payload.endpoints.filter((endpoint) => endpoint.nodeId === node.id),
        this.now()
      );
    }
  }

  assertProvisionalSpaceIsEmpty(userId, spaceId) {
    const replicationCount = this.database.prepare(
      `SELECT
         (SELECT COUNT(*) FROM replication_operations WHERE space_id = ?) +
         (SELECT COUNT(*) FROM idempotency_requests WHERE space_id = ?) AS count`
    ).get(spaceId, spaceId).count;
    if (replicationCount > 0) throw localDataConflict();
    const tables = this.database.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    ).all().map((row) => row.name);
    for (const table of tables) {
      if (LOCAL_TABLES.has(table) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(table)) continue;
      if (isPristineAccountProfile(this.database, table, userId)) continue;
      const columns = this.database.prepare(`PRAGMA table_info("${table}")`)
        .all().map((column) => column.name);
      if (!columns.includes("user_id")) continue;
      const count = this.database.prepare(
        `SELECT COUNT(*) AS count FROM "${table}" WHERE user_id = ?`
      ).get(userId).count;
      if (count > 0) throw localDataConflict();
    }
  }

}

function normalizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) invalidPackage();
  const nodes = Array.isArray(payload.nodes) ? payload.nodes.map(normalizeNode) : [];
  if (nodes.length < 2 || nodes.length > 16) invalidPackage();
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) invalidPackage();
  const localNodeId = identifier(payload.localNodeId, "localNodeId");
  const peerNodeId = identifier(payload.peerNodeId, "peerNodeId");
  const activeNodeId = identifier(payload.activeNodeId, "activeNodeId");
  if (
    localNodeId === peerNodeId ||
    !nodes.some((node) => node.id === localNodeId) ||
    !nodes.some((node) => node.id === peerNodeId) ||
    !nodes.some((node) => node.id === activeNodeId)
  ) {
    invalidPackage();
  }
  const spaceId = identifier(payload.spaceId, "spaceId");
  if (payload.space?.id !== spaceId) invalidPackage();
  const clusterState = normalizeClusterState(payload.clusterState, spaceId);
  if (
    clusterState.activeNodeId !== activeNodeId ||
    clusterState.epoch !== Number(payload.epoch)
  ) {
    invalidPackage();
  }
  const protocolVersion = positiveInteger(payload.protocolVersion);
  const schemaVersion = positiveInteger(payload.schemaVersion);
  if (
    nodes.some((node) =>
      node.protocolVersion !== protocolVersion || node.schemaVersion !== schemaVersion
    )
  ) {
    invalidPackage();
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const endpoints = Array.isArray(payload.endpoints)
    ? payload.endpoints.map((endpoint) => {
        const nodeId = identifier(endpoint?.nodeId, "endpoint.nodeId");
        if (!nodeIds.has(nodeId)) invalidPackage();
        const [normalized] = normalizeHubEndpoints([endpoint]);
        return { nodeId, ...normalized };
      })
    : [];
  return {
    protocolVersion,
    schemaVersion,
    spaceId,
    localNodeId,
    peerNodeId,
    activeNodeId,
    epoch: positiveInteger(payload.epoch),
    space: {
      id: spaceId,
      displayName: boundedString(payload.space.displayName, 120),
      createdAt: nonNegativeInteger(payload.space.createdAt)
    },
    clusterState,
    nodes,
    endpoints,
    peerCredential: {
      keyId: identifier(payload.peerCredential?.keyId, "keyId"),
      sharedSecret: String(payload.peerCredential?.sharedSecret || "")
    },
    spaceSyncKey: String(payload.spaceSyncKey || "")
  };
}

function normalizeNode(node) {
  if (!node || typeof node !== "object" || Array.isArray(node)) invalidPackage();
  return {
    id: identifier(node.id, "node.id"),
    name: requiredString(node.name, 120),
    platform: requiredString(node.platform, 40),
    publicIdentity: boundedString(node.publicIdentity, 4096),
    protocolVersion: positiveInteger(node.protocolVersion),
    schemaVersion: positiveInteger(node.schemaVersion),
    status: requiredString(node.status, 40),
    lastSeenAt: nullableInteger(node.lastSeenAt),
    createdAt: nonNegativeInteger(node.createdAt),
    revokedAt: nullableInteger(node.revokedAt)
  };
}

function normalizeClusterState(state, spaceId) {
  if (!state || typeof state !== "object" || Array.isArray(state)) invalidPackage();
  const normalized = {
    epoch: positiveInteger(state.epoch),
    activeNodeId: identifier(state.activeNodeId, "activeNodeId"),
    transitionId: boundedString(state.transitionId, 256),
    state: requiredString(state.state, 40),
    stateHash: String(state.stateHash || ""),
    controlSignature: boundedString(state.controlSignature, 4096),
    updatedAt: nonNegativeInteger(state.updatedAt)
  };
  const expectedHash = sha256Canonical({
    spaceId,
    epoch: normalized.epoch,
    activeNodeId: normalized.activeNodeId,
    transitionId: normalized.transitionId,
    state: normalized.state
  });
  if (normalized.stateHash !== expectedHash) {
    throw new HttpError(400, "HUB_IMPORT_STATE_HASH_INVALID", "集群控制状态摘要无效。");
  }
  return normalized;
}

function identifier(value, field) {
  const result = String(value || "").trim();
  if (!result || result.length > 256 || /[\u0000-\u001f]/.test(result)) {
    throw new HttpError(400, "HUB_IMPORT_PACKAGE_INVALID", `密钥包字段 ${field} 无效。`);
  }
  return result;
}

function requiredString(value, maximum) {
  const result = boundedString(value, maximum);
  if (!result) invalidPackage();
  return result;
}

function boundedString(value, maximum) {
  const result = String(value ?? "");
  if (result.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(result)) {
    invalidPackage();
  }
  return result;
}

function positiveInteger(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 1) invalidPackage();
  return result;
}

function nonNegativeInteger(value) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0) invalidPackage();
  return result;
}

function nullableInteger(value) {
  return value === null || value === undefined ? null : nonNegativeInteger(value);
}

function invalidPackage() {
  throw new HttpError(400, "HUB_IMPORT_PACKAGE_INVALID", "Hub 配对密钥包内容无效。");
}

function localDataConflict() {
  return new HttpError(
    409,
    "HUB_IMPORT_LOCAL_DATA_CONFLICT",
    "目标 Hub 已经存在本地业务数据，不能直接替换数据空间。"
  );
}

module.exports = { HubImportService };
