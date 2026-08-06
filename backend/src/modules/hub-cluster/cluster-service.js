const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { sha256Canonical } = require("../replication/operation-codec");
const { HttpError } = require("../../lib/http-error");

const CLUSTER_PROTOCOL_VERSION = 1;

class ClusterService {
  constructor(repository, options = {}) {
    this.repository = repository;
    this.nodeName = normalizeNodeName(options.nodeName || os.hostname() || "AetherX Hub");
    this.platform = String(options.platform || process.platform || "unknown");
    this.publicIdentity = String(options.publicIdentity || "");
    this.mobileHealthProvider = options.mobileHealthProvider || (() => []);
    this.replicationHealthProvider = options.replicationHealthProvider || (() => null);
    this.forcedTakeoverProvider = options.forcedTakeoverProvider || (() => null);
  }

  ensureSpace(userId) {
    const existing = this.repository.findContextByUserId(userId);
    if (existing) return this.refreshVersion(existing);
    return this.repository.transaction(() => {
      const concurrent = this.repository.findContextByUserId(userId);
      if (concurrent) return this.refreshVersion(concurrent);
      const now = Date.now();
      const schemaVersion = this.repository.schemaVersion();
      let instance = this.repository.findLocalInstance();
      if (!instance) {
        instance = this.repository.createLocalInstance({
          nodeId: randomUUID(),
          nodeName: this.nodeName,
          platform: this.platform,
          publicIdentity: this.publicIdentity,
          protocolVersion: CLUSTER_PROTOCOL_VERSION,
          schemaVersion,
          now
        });
      } else if (Number(instance.schema_version) !== schemaVersion) {
        instance = this.repository.updateLocalInstanceVersion(schemaVersion, now);
      }
      const spaceId = randomUUID();
      this.repository.createSpace({
        id: spaceId,
        userId,
        displayName: "",
        now
      });
      this.repository.createNode({
        id: instance.node_id,
        spaceId,
        nodeName: instance.node_name,
        platform: instance.platform,
        publicIdentity: instance.public_identity,
        protocolVersion: instance.protocol_version,
        schemaVersion,
        status: "active",
        now
      });
      const state = {
        spaceId,
        epoch: 1,
        activeNodeId: instance.node_id,
        transitionId: "",
        state: "stable"
      };
      this.repository.createClusterState({
        ...state,
        stateHash: sha256Canonical(state),
        controlSignature: "",
        now
      });
      return this.repository.findContextByUserId(userId);
    });
  }

  status(userId) {
    const context = this.ensureSpace(userId);
    const nodes = this.repository.listNodes(context.space_id).map((node) => ({
      id: node.id,
      name: node.node_name,
      platform: node.platform,
      protocolVersion: Number(node.protocol_version),
      schemaVersion: Number(node.schema_version),
      status: node.status,
      role: node.id === context.active_node_id ? "active" : "standby",
      lastSeenAt: node.last_seen_at,
      createdAt: node.created_at,
      revokedAt: node.revoked_at
    }));
    return {
      protocolVersion: Number(context.protocol_version),
      schemaVersion: Number(context.schema_version),
      spaceId: context.space_id,
      localNodeId: context.local_node_id,
      activeNodeId: context.active_node_id,
      epoch: Number(context.epoch),
      state: context.state,
      transitionId: context.transition_id,
      transitionTargetNodeId: context.transition_target_node_id || "",
      transitionStartedAt: context.transition_started_at,
      stateHash: context.state_hash,
      controlSignature: context.control_signature,
      forcedTakeover: this.forcedTakeoverProvider(context.space_id),
      localRole: context.local_node_id === context.active_node_id ? "active" : "standby",
      replication: {
        configured: nodes.length > 1,
        peerCount: Math.max(0, nodes.filter((node) => !node.revokedAt).length - 1),
        ready: nodes.length > 1 &&
          context.state === "stable" &&
          nodes
            .filter((node) => !node.revokedAt)
            .every((node) => ["active", "standby"].includes(node.status))
      },
      nodes
    };
  }

  mobileHubs(userId) {
    const cluster = this.status(userId);
    const clients = this.mobileHealthProvider(userId);
    return cluster.nodes
      .filter((node) => ["android", "ios"].includes(String(node.platform).toLowerCase()))
      .map((node) => {
        const latestSnapshot = this.repository.findLatestSnapshotForNode(cluster.spaceId, node.id);
        const snapshot = node.status === "standby"
          ? this.repository.findLatestCompletedSnapshotForNode(cluster.spaceId, node.id) || latestSnapshot
          : latestSnapshot;
        const client = clients.find((item) => item.localHub?.nodeId === node.id) || null;
        const snapshotStatus = snapshot?.status || "missing";
        const replicationHealth = this.replicationHealthProvider(cluster.spaceId, node.id);
        return {
          ...node,
          lastSeenAt: Math.max(Number(node.lastSeenAt || 0), Number(client?.lastHeartbeatAt || 0)) || null,
          active: node.id === cluster.activeNodeId,
          ready: node.status === "standby" && snapshotStatus === "completed",
          progress: client?.localHub || null,
          replication: replicationHealth ? {
            state: replicationHealth.state,
            localSequence: replicationHealth.localSequence,
            remoteSequence: replicationHealth.remoteSequence,
            caughtUp: replicationHealth.state === "healthy" &&
              replicationHealth.localSequence === replicationHealth.remoteSequence,
            lastSuccessAt: replicationHealth.lastSuccessAt,
            updatedAt: replicationHealth.updatedAt
          } : null,
          client: client ? {
            id: client.id,
            name: client.name,
            status: client.status,
            foreground: client.foreground,
            lastError: client.lastError,
            lastHeartbeatAt: client.lastHeartbeatAt,
            ageMs: client.ageMs
          } : null,
          snapshot: snapshot ? {
            id: snapshot.id,
            status: snapshotStatus,
            recordCount: Number(snapshot.record_count || 0),
            recordsRoot: snapshot.records_root,
            blobsRoot: snapshot.blobs_root,
            createdAt: Number(snapshot.created_at),
            completedAt: snapshot.completed_at == null ? null : Number(snapshot.completed_at)
          } : null
        };
      });
  }

  requireMobileHub(userId, nodeId) {
    const hub = this.mobileHubs(userId).find((item) => item.id === String(nodeId || ""));
    if (!hub || hub.revokedAt !== null) {
      throw new HttpError(404, "MOBILE_HUB_NOT_FOUND", "手机 Hub 节点不存在或已经被移除。");
    }
    return hub;
  }

  refreshVersion(context) {
    const schemaVersion = this.repository.schemaVersion();
    if (Number(context.schema_version) === schemaVersion) return context;
    const now = Date.now();
    this.repository.updateLocalInstanceVersion(schemaVersion, now);
    this.repository.updateLocalNodeVersion(
      context.space_id,
      context.local_node_id,
      schemaVersion,
      now
    );
    return this.repository.findContextByUserId(context.local_user_id);
  }
}

function normalizeNodeName(value) {
  const result = String(value || "").trim().slice(0, 120);
  return result || "AetherX Hub";
}

module.exports = { CLUSTER_PROTOCOL_VERSION, ClusterService };
