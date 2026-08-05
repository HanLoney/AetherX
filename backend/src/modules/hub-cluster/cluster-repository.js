class ClusterRepository {
  constructor(database) {
    this.database = database;
  }

  transaction(action) {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const result = action();
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  schemaVersion() {
    return Number(
      this.database
        .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations")
        .get().version
    );
  }

  findLocalInstance() {
    return this.database
      .prepare(
        `SELECT node_id, node_name, platform, public_identity,
                protocol_version, schema_version, created_at, updated_at
         FROM hub_instance WHERE singleton = 1`
      )
      .get();
  }

  createLocalInstance(input) {
    this.database
      .prepare(
        `INSERT INTO hub_instance(
           singleton, node_id, node_name, platform, public_identity,
           protocol_version, schema_version, created_at, updated_at
         ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.nodeId,
        input.nodeName,
        input.platform,
        input.publicIdentity,
        input.protocolVersion,
        input.schemaVersion,
        input.now,
        input.now
      );
    return this.findLocalInstance();
  }

  updateLocalInstanceVersion(schemaVersion, now) {
    this.database
      .prepare(
        `UPDATE hub_instance SET schema_version = ?, updated_at = ?
         WHERE singleton = 1 AND schema_version <> ?`
      )
      .run(schemaVersion, now, schemaVersion);
    return this.findLocalInstance();
  }

  findSpaceByUserId(userId) {
    return this.database
      .prepare(
        `SELECT id, local_user_id, display_name, created_at, updated_at
         FROM aetherx_spaces WHERE local_user_id = ?`
      )
      .get(userId);
  }

  listSpaceUserIds() {
    return this.database.prepare(
      "SELECT local_user_id FROM aetherx_spaces ORDER BY created_at, id"
    ).all().map((row) => row.local_user_id);
  }

  createSpace(input) {
    this.database
      .prepare(
        `INSERT INTO aetherx_spaces(
           id, local_user_id, display_name, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.id, input.userId, input.displayName, input.now, input.now);
    return this.findSpaceByUserId(input.userId);
  }

  createNode(input) {
    this.database
      .prepare(
        `INSERT INTO hub_nodes(
           id, space_id, node_name, platform, public_identity,
           protocol_version, schema_version, status, last_seen_at,
           created_at, revoked_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`
      )
      .run(
        input.id,
        input.spaceId,
        input.nodeName,
        input.platform,
        input.publicIdentity,
        input.protocolVersion,
        input.schemaVersion,
        input.status,
        input.lastSeenAt ?? input.now,
        input.createdAt ?? input.now
      );
    if (input.revokedAt !== null && input.revokedAt !== undefined) {
      this.database.prepare(
        "UPDATE hub_nodes SET revoked_at = ? WHERE space_id = ? AND id = ?"
      ).run(input.revokedAt, input.spaceId, input.id);
    }
  }

  updateLocalNodeVersion(spaceId, nodeId, schemaVersion, now) {
    this.database
      .prepare(
        `UPDATE hub_nodes
         SET schema_version = ?, last_seen_at = ?
         WHERE space_id = ? AND id = ?`
      )
      .run(schemaVersion, now, spaceId, nodeId);
  }

  updatePeerNodeVersion(spaceId, nodeId, protocolVersion, schemaVersion, now) {
    this.database.prepare(
      `UPDATE hub_nodes
       SET protocol_version = ?, schema_version = ?, last_seen_at = ?
       WHERE space_id = ? AND id = ? AND revoked_at IS NULL`
    ).run(protocolVersion, schemaVersion, now, spaceId, nodeId);
    return this.findNode(spaceId, nodeId);
  }

  createClusterState(input) {
    this.database
      .prepare(
        `INSERT INTO hub_cluster_state(
           space_id, epoch, active_node_id, transition_id, state,
           state_hash, control_signature, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.spaceId,
        input.epoch,
        input.activeNodeId,
        input.transitionId,
        input.state,
        input.stateHash,
        input.controlSignature,
        input.now
      );
  }

  updateClusterState(input) {
    this.database.prepare(
      `UPDATE hub_cluster_state
       SET epoch = ?, active_node_id = ?, transition_id = ?, state = ?,
           state_hash = ?, control_signature = ?,
           transition_target_node_id = ?, transition_started_at = ?,
           updated_at = ?
       WHERE space_id = ?`
    ).run(
      input.epoch,
      input.activeNodeId,
      input.transitionId,
      input.state,
      input.stateHash,
      input.controlSignature || "",
      input.transitionTargetNodeId || "",
      input.transitionStartedAt ?? null,
      input.updatedAt,
      input.spaceId
    );
    return this.findContextBySpaceId(input.spaceId);
  }

  findContextByUserId(userId) {
    return this.database
      .prepare(
        `SELECT
           space.id AS space_id,
           space.local_user_id,
           space.display_name,
           space.created_at AS space_created_at,
           instance.node_id AS local_node_id,
           instance.node_name AS local_node_name,
           instance.platform AS local_platform,
           instance.public_identity AS local_public_identity,
           instance.protocol_version,
           instance.schema_version,
           state.epoch,
           state.active_node_id,
           state.transition_id,
           state.transition_target_node_id,
           state.transition_started_at,
           state.state,
           state.state_hash,
           state.control_signature,
           state.updated_at AS state_updated_at
         FROM aetherx_spaces AS space
         JOIN hub_instance AS instance ON instance.singleton = 1
         JOIN hub_cluster_state AS state ON state.space_id = space.id
         WHERE space.local_user_id = ?`
      )
      .get(userId);
  }

  findContextBySpaceId(spaceId) {
    return this.database
      .prepare(
        `SELECT
           space.id AS space_id,
           space.local_user_id,
           space.display_name,
           space.created_at AS space_created_at,
           instance.node_id AS local_node_id,
           instance.node_name AS local_node_name,
           instance.platform AS local_platform,
           instance.public_identity AS local_public_identity,
           instance.protocol_version,
           instance.schema_version,
           state.epoch,
           state.active_node_id,
           state.transition_id,
           state.transition_target_node_id,
           state.transition_started_at,
           state.state,
           state.state_hash,
           state.control_signature,
           state.updated_at AS state_updated_at
         FROM aetherx_spaces AS space
         JOIN hub_instance AS instance ON instance.singleton = 1
         JOIN hub_cluster_state AS state ON state.space_id = space.id
         WHERE space.id = ?`
      )
      .get(spaceId);
  }

  updateLocalInstanceIdentity(input) {
    this.database.prepare(
      `UPDATE hub_instance
       SET node_name = ?, platform = ?, public_identity = ?,
           protocol_version = ?, schema_version = ?, updated_at = ?
       WHERE singleton = 1 AND node_id = ?`
    ).run(
      input.nodeName,
      input.platform,
      input.publicIdentity,
      input.protocolVersion,
      input.schemaVersion,
      input.now,
      input.nodeId
    );
    return this.findLocalInstance();
  }

  deleteSpaceForUser(userId) {
    return this.database
      .prepare("DELETE FROM aetherx_spaces WHERE local_user_id = ?")
      .run(userId).changes;
  }

  listNodes(spaceId) {
    return this.database
      .prepare(
        `SELECT id, node_name, platform, public_identity, protocol_version,
                schema_version, status, last_seen_at, created_at, revoked_at
         FROM hub_nodes WHERE space_id = ? ORDER BY created_at, id`
      )
      .all(spaceId);
  }

  findNode(spaceId, nodeId) {
    return this.database
      .prepare(
        `SELECT id, node_name, platform, public_identity, protocol_version,
                schema_version, status, last_seen_at, created_at, revoked_at
         FROM hub_nodes WHERE space_id = ? AND id = ?`
      )
      .get(spaceId, nodeId);
  }

  findLatestSnapshotForNode(spaceId, nodeId) {
    return this.database
      .prepare(
        `SELECT snapshot.id, snapshot.status, snapshot.records_root,
                snapshot.blobs_root, snapshot.created_at, snapshot.completed_at,
                COALESCE(SUM(snapshot_table.row_count), 0) AS record_count
         FROM replication_snapshots AS snapshot
         LEFT JOIN replication_snapshot_tables AS snapshot_table
           ON snapshot_table.snapshot_id = snapshot.id
         WHERE snapshot.space_id = ? AND snapshot.requested_by_node_id = ?
         GROUP BY snapshot.id
         ORDER BY snapshot.created_at DESC
         LIMIT 1`
      )
      .get(spaceId, nodeId);
  }

  findLatestCompletedSnapshotForNode(spaceId, nodeId) {
    return this.database
      .prepare(
        `SELECT snapshot.id, snapshot.status, snapshot.records_root,
                snapshot.blobs_root, snapshot.created_at, snapshot.completed_at,
                COALESCE(SUM(snapshot_table.row_count), 0) AS record_count
         FROM replication_snapshots AS snapshot
         LEFT JOIN replication_snapshot_tables AS snapshot_table
           ON snapshot_table.snapshot_id = snapshot.id
         WHERE snapshot.space_id = ? AND snapshot.requested_by_node_id = ?
           AND snapshot.status = 'completed'
         GROUP BY snapshot.id
         ORDER BY snapshot.completed_at DESC, snapshot.created_at DESC
         LIMIT 1`
      )
      .get(spaceId, nodeId);
  }

  updateNodeStatus(spaceId, nodeId, status, lastSeenAt) {
    this.database.prepare(
      `UPDATE hub_nodes SET status = ?, last_seen_at = ?
       WHERE space_id = ? AND id = ? AND revoked_at IS NULL`
    ).run(status, lastSeenAt, spaceId, nodeId);
    return this.findNode(spaceId, nodeId);
  }

  touchNode(spaceId, nodeId, lastSeenAt) {
    this.database.prepare(
      `UPDATE hub_nodes SET last_seen_at = ?
       WHERE space_id = ? AND id = ? AND revoked_at IS NULL`
    ).run(lastSeenAt, spaceId, nodeId);
    return this.findNode(spaceId, nodeId);
  }
}

module.exports = { ClusterRepository };
