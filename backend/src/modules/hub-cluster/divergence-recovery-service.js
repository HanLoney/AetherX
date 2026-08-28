const {
  createHash,
  createHmac,
  randomUUID,
  timingSafeEqual
} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { HttpError } = require("../../lib/http-error");
const {
  DIGEST_ALGORITHM,
  FORMAT_VERSION,
  TABLES,
  continuityDigest
} = require("../archive/archive-format");
const {
  buildManifest,
  decryptPayload,
  encryptPayload
} = require("../replication/integrity-service");
const {
  canonicalStringify,
  sha256Canonical,
  validateOperation
} = require("../replication/operation-codec");

const EVIDENCE_FORMAT = "AetherX Hub Divergence Evidence";
const EVIDENCE_FORMAT_VERSION = 1;
const RECOVERY_FORMAT = "AetherX Hub Divergence Recovery Snapshot";
const RECOVERY_FORMAT_VERSION = 1;
const MAX_RECOVERY_BYTES = 64 * 1024 * 1024;
const MAX_RECOVERY_CHUNK_BYTES = 512 * 1024;
const MEDIA_CHUNK_BYTES = 1024 * 1024;

class DivergenceRecoveryService {
  constructor({
    database,
    clusterService,
    clusterRepository,
    repository,
    replicationRepository,
    archiveService,
    spaceKeyService,
    syncEventBroker,
    now = () => Date.now()
  }) {
    this.database = database;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.repository = repository;
    this.replicationRepository = replicationRepository;
    this.archiveService = archiveService;
    this.spaceKeyService = spaceKeyService;
    this.syncEventBroker = syncEventBroker;
    this.now = now;
  }

  status(userId, options = {}) {
    const context = this.clusterService.ensureSpace(userId);
    const takeover = this.repository.latest(context.space_id);
    if (!takeover) {
      return {
        available: false,
        clusterState: context.state,
        divergentOperationCount: 0,
        recovery: null,
        operations: []
      };
    }
    const operations = this.repository.listAllDivergentOperations(
      context.space_id,
      takeover.id
    );
    const total = operations.length;
    const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
    const offset = Math.max(0, Number(options.offset) || 0);
    return {
      available: context.state === "divergent" || context.state === "recovering_divergence" || total > 0,
      clusterState: context.state,
      spaceId: context.space_id,
      localNodeId: context.local_node_id,
      activeNodeId: context.active_node_id,
      epoch: Number(context.epoch),
      takeover: presentTakeover(takeover),
      recovery: presentRecovery(this.repository.latestRecovery(context.space_id)),
      divergentOperationCount: total,
      offset,
      limit,
      hasMore: offset + limit < total,
      operations: operations.slice(offset, offset + limit)
    };
  }

  exportEvidence(userId) {
    const context = this.clusterService.ensureSpace(userId);
    const takeover = this.repository.latest(context.space_id);
    const divergentOperations = takeover
      ? this.repository.listAllDivergentOperations(context.space_id, takeover.id)
      : [];
    if (!takeover || divergentOperations.length === 0) {
      throw new HttpError(
        409,
        "DIVERGENCE_EVIDENCE_UNAVAILABLE",
        "当前没有需要导出的 Hub 分歧证据。"
      );
    }
    const evidence = {
      format: EVIDENCE_FORMAT,
      formatVersion: EVIDENCE_FORMAT_VERSION,
      generatedAt: this.now(),
      cluster: {
        spaceId: context.space_id,
        localNodeId: context.local_node_id,
        activeNodeId: context.active_node_id,
        epoch: Number(context.epoch),
        state: context.state
      },
      takeover: {
        ...presentTakeover(takeover),
        proofHash: takeover.proof_hash,
        controlSignature: takeover.control_signature,
        proof: parseObject(takeover.proof_json, "强制接管证明"),
        integrity: parseObject(takeover.integrity_json, "强制接管完整性证据")
      },
      recovery: presentRecovery(this.repository.latestRecovery(context.space_id)),
      divergentOperations
    };
    const evidenceHash = sha256Canonical(evidence);
    const key = this.spaceKeyService.ensure(context.space_id).key;
    return {
      ...evidence,
      evidenceHash,
      authenticationTag: createHmac("sha256", key)
        .update(evidenceHash, "utf8")
        .digest("hex")
    };
  }

  async initiate(userId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    const takeover = this.requireDivergence(context);
    const existing = this.repository.activeRecovery(context.space_id);
    if (existing) {
      try {
        this.publishRecoveryCommand(userId, context, existing);
        return presentRecovery(existing);
      } catch (error) {
        this.repository.updateRecoveryStatus(existing.id, "failed", this.now(), error);
        throw error;
      }
    }
    const authority = String(input.authority || "");
    const authorityNodeId = authority === "desktop"
      ? context.local_node_id
      : authority === "mobile"
        ? takeover.active_node_id
        : "";
    if (!authorityNodeId) {
      throw new HttpError(
        400,
        "DIVERGENCE_AUTHORITY_INVALID",
        "恢复时必须明确选择保留手机 Hub 或电脑 Hub。"
      );
    }
    const targetNodeId = authorityNodeId === context.local_node_id
      ? takeover.active_node_id
      : context.local_node_id;
    const createdAt = this.now();
    let recovery = this.repository.createRecovery({
      id: randomUUID(),
      spaceId: context.space_id,
      takeoverId: takeover.id,
      authorityNodeId,
      targetNodeId,
      sourceEpoch: Number(context.epoch),
      targetEpoch: Number(context.epoch) + 1,
      status: authorityNodeId === context.local_node_id
        ? "preparing_desktop_snapshot"
        : "awaiting_mobile_snapshot",
      createdAt
    });
    try {
      if (authorityNodeId === context.local_node_id) {
        recovery = await this.prepareDesktopSnapshot(userId, context, recovery);
      }
      this.publishRecoveryCommand(userId, context, recovery);
      return presentRecovery(recovery);
    } catch (error) {
      this.repository.updateRecoveryStatus(recovery.id, "failed", this.now(), error);
      throw error;
    }
  }

  peerStatus(userId, peerNodeId, recoveryId) {
    const { recovery } = this.requireRecovery(userId, peerNodeId, recoveryId);
    return presentPeerRecovery(recovery);
  }

  receiveSnapshotChunk(userId, peerNodeId, recoveryId, input = {}) {
    const { context, recovery } = this.requireRecovery(userId, peerNodeId, recoveryId);
    if (
      recovery.authority_node_id !== peerNodeId ||
      recovery.status !== "awaiting_mobile_snapshot"
    ) {
      throw recoveryConflict("当前恢复会话不接收手机快照。");
    }
    const offset = safeInteger(input.offset, "offset", 0);
    const bytes = decodeChunk(input.data);
    if (!bytes.length || bytes.length > MAX_RECOVERY_CHUNK_BYTES) {
      throw new HttpError(400, "DIVERGENCE_SNAPSHOT_CHUNK_INVALID", "恢复快照分块大小无效。");
    }
    const chunkHash = String(input.chunkHash || "").toLowerCase();
    if (chunkHash !== sha256(bytes)) {
      throw new HttpError(409, "DIVERGENCE_SNAPSHOT_CHUNK_HASH_MISMATCH", "恢复快照分块校验失败。");
    }
    const chunks = this.repository.recoveryChunks(recovery.id);
    const expectedOffset = chunks.reduce((sum, item) => sum + item.chunk_data.length, 0);
    if (offset < expectedOffset) {
      const duplicate = chunks.find((item) => Number(item.byte_offset) === offset);
      if (duplicate && Buffer.compare(duplicate.chunk_data, bytes) === 0) {
        return { recoveryId: recovery.id, receivedBytes: expectedOffset, duplicate: true };
      }
    }
    if (offset !== expectedOffset || offset + bytes.length > MAX_RECOVERY_BYTES) {
      throw new HttpError(
        409,
        "DIVERGENCE_SNAPSHOT_OFFSET_MISMATCH",
        "恢复快照必须从已确认偏移继续上传。",
        { expectedOffset, receivedOffset: offset }
      );
    }
    this.repository.saveRecoveryChunk(recovery.id, offset, bytes, chunkHash, this.now());
    return {
      recoveryId: recovery.id,
      receivedBytes: offset + bytes.length,
      duplicate: false,
      spaceId: context.space_id
    };
  }

  async completeSnapshotUpload(userId, peerNodeId, recoveryId, input = {}) {
    const { context, recovery } = this.requireRecovery(userId, peerNodeId, recoveryId);
    if (
      recovery.authority_node_id !== peerNodeId ||
      recovery.status !== "awaiting_mobile_snapshot"
    ) {
      throw recoveryConflict("当前恢复会话不能完成手机快照上传。");
    }
    const chunks = this.repository.recoveryChunks(recovery.id);
    let expectedOffset = 0;
    for (const item of chunks) {
      if (Number(item.byte_offset) !== expectedOffset || sha256(item.chunk_data) !== item.chunk_hash) {
        throw new HttpError(409, "DIVERGENCE_SNAPSHOT_INCOMPLETE", "恢复快照分块不连续或已经损坏。");
      }
      expectedOffset += item.chunk_data.length;
    }
    const expectedBytes = safeInteger(input.byteSize, "byteSize", 1);
    if (expectedOffset !== expectedBytes || expectedBytes > MAX_RECOVERY_BYTES) {
      throw new HttpError(409, "DIVERGENCE_SNAPSHOT_INCOMPLETE", "恢复快照尚未完整上传。");
    }
    try {
      const bytes = Buffer.concat(chunks.map((item) => item.chunk_data));
      const envelope = JSON.parse(bytes.toString("utf8"));
      const payloadHash = sha256Canonical(envelope);
      if (payloadHash !== String(input.payloadHash || "").toLowerCase()) {
        throw new HttpError(409, "DIVERGENCE_SNAPSHOT_HASH_MISMATCH", "恢复快照总摘要不一致。");
      }
      const verified = this.verifyEnvelope(context, recovery, envelope);
      const control = this.createControl(recovery, verified.snapshotHash);
      const controlSignature = signCanonical(control, this.spaceKeyService.ensure(context.space_id).key);
      await this.restoreMobileAuthoritySnapshot(
        userId,
        context,
        recovery,
        verified,
        envelope,
        payloadHash,
        control,
        controlSignature
      );
      this.repository.clearRecoveryChunks(recovery.id);
      return {
        recovery: presentPeerRecovery(this.repository.findRecovery(recovery.id)),
        signedControl: { control, authenticationTag: controlSignature }
      };
    } catch (error) {
      this.repository.clearRecoveryChunks(recovery.id);
      this.repository.updateRecoveryStatus(recovery.id, "failed", this.now(), error);
      throw error;
    }
  }

  getSnapshotChunk(userId, peerNodeId, recoveryId, query = {}) {
    const { recovery } = this.requireRecovery(userId, peerNodeId, recoveryId);
    if (!recovery.encrypted_snapshot_json || !recovery.payload_hash) {
      throw recoveryConflict("恢复快照尚未准备完成。");
    }
    const bytes = Buffer.from(recovery.encrypted_snapshot_json, "utf8");
    const offset = safeInteger(query.offset, "offset", 0);
    if (offset >= bytes.length) {
      throw new HttpError(416, "DIVERGENCE_SNAPSHOT_RANGE_INVALID", "恢复快照分块范围无效。");
    }
    const length = Math.min(
      MAX_RECOVERY_CHUNK_BYTES,
      safeInteger(query.length || MAX_RECOVERY_CHUNK_BYTES, "length", 1),
      bytes.length - offset
    );
    const chunk = bytes.subarray(offset, offset + length);
    return {
      recoveryId: recovery.id,
      offset,
      totalBytes: bytes.length,
      data: chunk.toString("base64"),
      chunkHash: sha256(chunk),
      payloadHash: recovery.payload_hash,
      snapshotHash: recovery.snapshot_hash
    };
  }

  getMediaChunk(userId, peerNodeId, recoveryId, mediaId, query = {}) {
    const { context, recovery } = this.requireRecovery(userId, peerNodeId, recoveryId);
    if (recovery.authority_node_id !== context.local_node_id) {
      throw recoveryConflict("手机权威恢复不会从电脑下载媒体文件。");
    }
    const verified = this.verifyStoredEnvelope(context, recovery);
    const item = verified.packageValue.media.find((candidate) => candidate.id === mediaId);
    if (!item) throw new HttpError(404, "DIVERGENCE_MEDIA_NOT_FOUND", "恢复媒体不存在。");
    const filePath = safeMediaPath(this.archiveService.mediaDir, item.fileName);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size !== item.byteSize) {
      throw new HttpError(409, "DIVERGENCE_MEDIA_MISSING", "电脑权威分支的恢复媒体不完整。");
    }
    const offset = safeInteger(query.offset, "offset", 0);
    if (offset >= item.byteSize) throw new HttpError(416, "DIVERGENCE_MEDIA_RANGE_INVALID", "恢复媒体范围无效。");
    const length = Math.min(
      MEDIA_CHUNK_BYTES,
      safeInteger(query.length || MEDIA_CHUNK_BYTES, "length", 1),
      item.byteSize - offset
    );
    const descriptor = fs.openSync(filePath, "r");
    try {
      const bytes = Buffer.alloc(length);
      const read = fs.readSync(descriptor, bytes, 0, length, offset);
      const chunk = bytes.subarray(0, read);
      return {
        bytes: chunk,
        offset,
        byteSize: item.byteSize,
        contentHash: item.contentHash,
        chunkHash: sha256(chunk)
      };
    } finally {
      fs.closeSync(descriptor);
    }
  }

  acknowledge(userId, peerNodeId, recoveryId, input = {}) {
    const { context, recovery } = this.requireRecovery(userId, peerNodeId, recoveryId);
    if (recovery.status === "completed") return presentPeerRecovery(recovery);
    if (recovery.status !== "awaiting_peer_ack") {
      throw recoveryConflict("恢复会话尚未等待手机确认。");
    }
    const ack = input.ack;
    const key = this.spaceKeyService.ensure(context.space_id).key;
    if (
      !ack ||
      ack.recoveryId !== recovery.id ||
      ack.spaceId !== context.space_id ||
      ack.nodeId !== peerNodeId ||
      ack.authorityNodeId !== recovery.authority_node_id ||
      Number(ack.epoch) !== Number(recovery.target_epoch) ||
      ack.snapshotHash !== recovery.snapshot_hash ||
      !safeTag(input.authenticationTag, signCanonical(ack, key))
    ) {
      throw new HttpError(409, "DIVERGENCE_RECOVERY_ACK_INVALID", "手机 Hub 的恢复确认无效。");
    }
    const completedAt = this.now();
    this.database.exec("BEGIN IMMEDIATE");
    try {
      if (recovery.authority_node_id === context.local_node_id) {
        this.repository.archiveDivergentOperations(
          context.space_id,
          recovery.takeover_id,
          "kept_desktop",
          completedAt
        );
      }
      const nextState = {
        spaceId: context.space_id,
        epoch: Number(recovery.target_epoch),
        activeNodeId: recovery.authority_node_id,
        transitionId: "",
        transitionTargetNodeId: "",
        transitionStartedAt: null,
        state: "stable"
      };
      this.clusterRepository.updateClusterState({
        ...nextState,
        stateHash: sha256Canonical(nextState),
        controlSignature: recovery.control_signature,
        updatedAt: completedAt
      });
      for (const node of this.clusterRepository.listNodes(context.space_id)) {
        this.clusterRepository.updateNodeStatus(
          context.space_id,
          node.id,
          node.id === recovery.authority_node_id ? "active" : "standby",
          completedAt
        );
      }
      this.repository.markReconciled(context.space_id, recovery.takeover_id, completedAt);
      this.repository.updateRecoveryStatus(recovery.id, "completed", completedAt);
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    this.publishClusterChanged(userId, recovery);
    return presentPeerRecovery(this.repository.findRecovery(recovery.id));
  }

  async prepareDesktopSnapshot(userId, context, recovery) {
    return this.archiveService.withUserLock(userId, async () => {
      this.archiveService.requireAgentIdle(userId);
      const snapshot = await this.archiveService.collectSnapshot(userId);
      const packageValue = this.createPackage(context, recovery, snapshot);
      const snapshotHash = sha256Canonical(packageValue);
      const envelope = encryptPayload(
        packageValue,
        this.spaceKeyService.ensure(context.space_id).key,
        recoveryAad(recovery, snapshotHash)
      );
      const payloadHash = sha256Canonical(envelope);
      const encoded = canonicalStringify(envelope);
      if (Buffer.byteLength(encoded, "utf8") > MAX_RECOVERY_BYTES) {
        throw new HttpError(413, "DIVERGENCE_SNAPSHOT_TOO_LARGE", "恢复快照超过当前分块协议上限。");
      }
      const control = this.createControl(recovery, snapshotHash);
      const signature = signCanonical(
        control,
        this.spaceKeyService.ensure(context.space_id).key
      );
      return this.repository.saveRecoverySnapshot(recovery.id, {
        encryptedSnapshotJson: encoded,
        payloadHash,
        snapshotHash,
        controlJson: canonicalStringify(control),
        controlSignature: signature,
        status: "awaiting_peer_ack",
        updatedAt: this.now()
      });
    });
  }

  createPackage(context, recovery, snapshot) {
    const boundary = this.captureBoundary(context.space_id);
    const manifest = buildManifest({
      snapshot,
      context,
      boundary,
      now: this.now(),
      sourceNodeId: recovery.authority_node_id
    });
    return {
      format: RECOVERY_FORMAT,
      formatVersion: RECOVERY_FORMAT_VERSION,
      snapshotId: recovery.id,
      recoveryId: recovery.id,
      takeoverId: recovery.takeover_id,
      spaceId: context.space_id,
      sourceNodeId: recovery.authority_node_id,
      sourceEpoch: Number(recovery.source_epoch),
      targetEpoch: Number(recovery.target_epoch),
      tables: snapshot.records,
      account: snapshot.account,
      credentials: snapshot.credentials,
      media: snapshot.media.map(({ filePath: _filePath, ...item }) => item),
      manifest,
      replication: this.collectReplication(context.space_id, boundary),
      createdAt: this.now()
    };
  }

  captureBoundary(spaceId) {
    return {
      syncCursor: 0,
      operations: Object.fromEntries(
        this.replicationRepository.listOperationHeads(spaceId).map((head) => [
          head.originNodeId,
          {
            sequence: head.contiguousSequence,
            operationHash: head.operationHash
          }
        ])
      )
    };
  }

  collectReplication(spaceId, boundary) {
    const operations = [];
    for (const [originNodeId, head] of Object.entries(boundary.operations)) {
      let after = 0;
      while (after < head.sequence) {
        const batch = this.replicationRepository.listOperations(
          spaceId,
          originNodeId,
          after,
          Math.min(1000, head.sequence - after)
        );
        if (!batch.length) break;
        operations.push(...batch);
        after = batch.at(-1).originSequence;
      }
    }
    return {
      operations,
      entityVersions: this.database.prepare(
        `SELECT entity_type AS entityType, entity_id AS entityId,
                version, updated_at AS updatedAt
         FROM replication_entity_versions WHERE space_id = ?
         ORDER BY entity_type, entity_id`
      ).all(spaceId).map((item) => ({
        ...item,
        version: Number(item.version),
        updatedAt: Number(item.updatedAt)
      }))
    };
  }

  verifyEnvelope(context, recovery, envelope) {
    const packageValue = decryptPayload(
      envelope,
      this.spaceKeyService.ensure(context.space_id).key
    );
    const snapshotHash = sha256Canonical(packageValue);
    const aad = envelope?.aad || {};
    if (canonicalStringify(aad) !== canonicalStringify(recoveryAad(recovery, snapshotHash))) {
      throw new HttpError(409, "DIVERGENCE_SNAPSHOT_CONTEXT_MISMATCH", "恢复快照与当前分歧会话不匹配。");
    }
    this.validatePackage(context, recovery, packageValue, snapshotHash);
    return { packageValue, snapshotHash };
  }

  verifyStoredEnvelope(context, recovery) {
    return this.verifyEnvelope(
      context,
      recovery,
      JSON.parse(recovery.encrypted_snapshot_json)
    );
  }

  validatePackage(context, recovery, packageValue, snapshotHash) {
    if (
      packageValue?.format !== RECOVERY_FORMAT ||
      Number(packageValue.formatVersion) !== RECOVERY_FORMAT_VERSION ||
      packageValue.recoveryId !== recovery.id ||
      packageValue.takeoverId !== recovery.takeover_id ||
      packageValue.spaceId !== context.space_id ||
      packageValue.sourceNodeId !== recovery.authority_node_id ||
      Number(packageValue.sourceEpoch) !== Number(recovery.source_epoch) ||
      Number(packageValue.targetEpoch) !== Number(recovery.target_epoch) ||
      !packageValue.tables || !packageValue.account || !packageValue.credentials ||
      !Array.isArray(packageValue.media) || !packageValue.manifest ||
      !packageValue.replication
    ) {
      throw new HttpError(409, "DIVERGENCE_SNAPSHOT_INVALID", "恢复快照格式或身份无效。");
    }
    const snapshot = {
      account: packageValue.account,
      credentials: packageValue.credentials,
      records: Object.fromEntries(TABLES.map((table) => [table, packageValue.tables[table] || []])),
      media: packageValue.media
    };
    const expectedManifest = buildManifest({
      snapshot,
      context,
      boundary: packageValue.manifest.boundary,
      now: packageValue.manifest.createdAt,
      sourceNodeId: recovery.authority_node_id
    });
    if (
      expectedManifest.manifestHash !== packageValue.manifest.manifestHash ||
      expectedManifest.recordsRoot !== packageValue.manifest.recordsRoot ||
      expectedManifest.blobsRoot !== packageValue.manifest.blobsRoot
    ) {
      throw new HttpError(409, "DIVERGENCE_SNAPSHOT_MANIFEST_MISMATCH", "恢复快照记录根或媒体根不一致。");
    }
    this.archiveService.validateRecordShape(snapshot.records);
    this.validateReplication(context, recovery, packageValue.replication, packageValue.manifest.boundary);
    if (!/^[a-f0-9]{64}$/.test(snapshotHash)) {
      throw new HttpError(409, "DIVERGENCE_SNAPSHOT_HASH_INVALID", "恢复快照摘要无效。");
    }
  }

  validateReplication(context, recovery, replication, boundary) {
    if (!Array.isArray(replication.operations) || !Array.isArray(replication.entityVersions)) {
      throw new HttpError(409, "DIVERGENCE_REPLICATION_INVALID", "恢复快照缺少完整复制状态。");
    }
    const key = this.spaceKeyService.ensure(context.space_id).key;
    const grouped = new Map();
    for (const input of replication.operations) {
      const operation = validateOperation(input, { syncKey: key });
      if (
        operation.spaceId !== context.space_id ||
        operation.epoch > Number(recovery.source_epoch) ||
        !this.clusterRepository.findNode(context.space_id, operation.originNodeId)
      ) {
        throw new HttpError(409, "DIVERGENCE_OPERATION_INVALID", "恢复快照包含不属于当前集群的 Operation。");
      }
      const list = grouped.get(operation.originNodeId) || [];
      list.push(operation);
      grouped.set(operation.originNodeId, list);
    }
    for (const [originNodeId, head] of Object.entries(boundary.operations || {})) {
      const list = (grouped.get(originNodeId) || [])
        .sort((left, right) => left.originSequence - right.originSequence);
      let previousHash = "";
      for (let index = 0; index < list.length; index += 1) {
        const operation = list[index];
        if (
          operation.originSequence !== index + 1 ||
          operation.previousOperationHash !== previousHash
        ) {
          throw new HttpError(409, "DIVERGENCE_OPERATION_CHAIN_BROKEN", "恢复快照中的 Operation 哈希链不连续。");
        }
        previousHash = operation.operationHash;
      }
      if (list.length !== Number(head.sequence) || previousHash !== String(head.operationHash || "")) {
        throw new HttpError(409, "DIVERGENCE_OPERATION_HEAD_MISMATCH", "恢复快照中的 Operation 链头不一致。");
      }
    }
    for (const originNodeId of grouped.keys()) {
      if (!Object.hasOwn(boundary.operations || {}, originNodeId)) {
        throw new HttpError(409, "DIVERGENCE_OPERATION_HEAD_MISMATCH", "恢复快照包含边界之外的 Operation 来源。");
      }
    }
  }

  async restoreMobileAuthoritySnapshot(
    userId,
    context,
    recovery,
    verified,
    envelope,
    payloadHash,
    control,
    controlSignature
  ) {
    const metadata = buildRecoveryMetadata(verified.packageValue);
    const staged = await this.stageExistingMedia(verified.packageValue.media, recovery.id);
    try {
      this.archiveService.replaceUserData(userId, metadata, staged.items, {
        beforeCommit: () => {
          const restoredAt = this.now();
          this.repository.archiveDivergentOperations(
            context.space_id,
            recovery.takeover_id,
            "kept_mobile",
            restoredAt
          );
          this.replaceReplicationState(
            context.space_id,
            verified.packageValue.replication,
            restoredAt
          );
          const nextState = {
            spaceId: context.space_id,
            epoch: Number(recovery.target_epoch),
            activeNodeId: recovery.authority_node_id,
            transitionId: recovery.id,
            transitionTargetNodeId: recovery.target_node_id,
            transitionStartedAt: recovery.created_at,
            state: "recovering_divergence"
          };
          this.clusterRepository.updateClusterState({
            ...nextState,
            stateHash: sha256Canonical(nextState),
            controlSignature,
            updatedAt: restoredAt
          });
          this.repository.saveRecoverySnapshot(recovery.id, {
            encryptedSnapshotJson: canonicalStringify(envelope),
            payloadHash,
            snapshotHash: verified.snapshotHash,
            controlJson: canonicalStringify(control),
            controlSignature,
            status: "awaiting_peer_ack",
            updatedAt: restoredAt
          });
          return { recoveryId: recovery.id, snapshotHash: verified.snapshotHash };
        }
      });
      fs.rmSync(staged.directory, { recursive: true, force: true });
    } catch (error) {
      fs.rmSync(staged.directory, { recursive: true, force: true });
      this.repository.updateRecoveryStatus(recovery.id, "failed", this.now(), error);
      throw error;
    }
  }

  replaceReplicationState(spaceId, replication, appliedAt) {
    this.database.prepare("DELETE FROM applied_operations WHERE space_id = ?").run(spaceId);
    this.database.prepare("DELETE FROM replication_watermarks WHERE space_id = ?").run(spaceId);
    this.database.prepare("DELETE FROM replication_entity_versions WHERE space_id = ?").run(spaceId);
    this.database.prepare("DELETE FROM idempotency_requests WHERE space_id = ?").run(spaceId);
    this.database.prepare("DELETE FROM replication_operations WHERE space_id = ?").run(spaceId);
    for (const operation of replication.operations) {
      this.replicationRepository.insertOperation(operation);
      this.replicationRepository.markApplied(operation.operationId, spaceId, appliedAt);
    }
    for (const version of replication.entityVersions) {
      this.replicationRepository.setEntityVersion(
        spaceId,
        version.entityType,
        version.entityId,
        Number(version.version),
        Number(version.updatedAt)
      );
    }
  }

  async stageExistingMedia(media, recoveryId) {
    const directory = path.join(this.archiveService.tempDir, `divergence-${recoveryId}`);
    fs.rmSync(directory, { recursive: true, force: true });
    fs.mkdirSync(directory, { recursive: false });
    const items = [];
    try {
      for (const item of media) {
        const source = safeMediaPath(this.archiveService.mediaDir, item.fileName);
        if (
          !fs.existsSync(source) ||
          fs.statSync(source).size !== Number(item.byteSize) ||
          await hashFile(source) !== item.contentHash
        ) {
          throw new HttpError(
            409,
            "DIVERGENCE_MEDIA_INCOMPLETE",
            `恢复媒体 ${item.id} 尚未完整同步到电脑 Hub。`
          );
        }
        const stagePath = path.join(directory, item.fileName);
        fs.copyFileSync(source, stagePath);
        items.push({ ...item, stagePath });
      }
      return { directory, items };
    } catch (error) {
      fs.rmSync(directory, { recursive: true, force: true });
      throw error;
    }
  }

  createControl(recovery, snapshotHash) {
    return {
      version: 1,
      action: "apply_divergence_recovery",
      recoveryId: recovery.id,
      takeoverId: recovery.takeover_id,
      spaceId: recovery.space_id,
      authorityNodeId: recovery.authority_node_id,
      targetNodeId: recovery.target_node_id,
      activeNodeId: recovery.authority_node_id,
      sourceEpoch: Number(recovery.source_epoch),
      epoch: Number(recovery.target_epoch),
      snapshotHash,
      issuedAt: this.now()
    };
  }

  publishRecoveryCommand(userId, context, recovery) {
    const mobileNodeId = [recovery.authority_node_id, recovery.target_node_id]
      .find((nodeId) => nodeId !== context.local_node_id);
    const hub = this.clusterService.requireMobileHub(userId, mobileNodeId);
    if (!hub.client?.id) {
      throw new HttpError(
        409,
        "MOBILE_HUB_CONTROL_OFFLINE",
        "手机 Hub 尚未建立恢复控制通道，请先打开手机上的 AetherX。"
      );
    }
    const command = {
      commandId: randomUUID(),
      type: "resolve-hub-divergence",
      nodeId: mobileNodeId,
      recoveryId: recovery.id,
      authorityNodeId: recovery.authority_node_id,
      requestedAt: this.now()
    };
    const delivery = this.syncEventBroker.publish(userId, "hub-command", command, {
      queueWhenOffline: true,
      alwaysQueue: true,
      clientId: hub.client.id
    });
    if (delivery.delivered === 0 && !delivery.queued) {
      throw new HttpError(409, "MOBILE_HUB_CONTROL_OFFLINE", "手机 Hub 恢复命令未能送达。");
    }
  }

  publishClusterChanged(userId, recovery) {
    try {
      this.syncEventBroker.publish(userId, "cluster-change", {
        action: "divergence_recovered",
        recoveryId: recovery.id,
        authorityNodeId: recovery.authority_node_id,
        cluster: this.clusterService.status(userId)
      });
    } catch {}
  }

  requireDivergence(context) {
    const takeover = this.repository.latest(context.space_id);
    if (!takeover || !["divergent", "recovering_divergence"].includes(context.state)) {
      throw new HttpError(409, "DIVERGENCE_RECOVERY_NOT_REQUIRED", "当前 Hub 集群没有需要闭环处理的分歧。");
    }
    return takeover;
  }

  requireRecovery(userId, peerNodeId, recoveryId) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = this.clusterRepository.findNode(context.space_id, peerNodeId);
    const recovery = this.repository.findRecovery(String(recoveryId || ""));
    if (
      !peer ||
      peer.revoked_at !== null ||
      !recovery ||
      recovery.space_id !== context.space_id ||
      ![recovery.authority_node_id, recovery.target_node_id].includes(peerNodeId)
    ) {
      throw new HttpError(404, "DIVERGENCE_RECOVERY_NOT_FOUND", "分歧恢复会话不存在。");
    }
    return { context, recovery };
  }
}

function buildRecoveryMetadata(packageValue) {
  const records = Object.fromEntries(TABLES.map((table) => [
    table,
    packageValue.tables[table] || []
  ]));
  const metadata = {
    format: "AetherX Full Archive",
    formatVersion: FORMAT_VERSION,
    digestAlgorithm: DIGEST_ALGORITHM,
    archiveMode: "full_restore_only",
    createdAt: Number(packageValue.createdAt),
    label: "Hub divergence recovery",
    account: packageValue.account,
    credentials: packageValue.credentials,
    records,
    media: packageValue.media,
    recordCounts: Object.fromEntries(TABLES.map((table) => [table, records[table].length])),
    totalMediaBytes: packageValue.media.reduce((sum, item) => sum + Number(item.byteSize), 0)
  };
  metadata.continuityDigest = continuityDigest(metadata);
  return metadata;
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

function presentTakeover(row) {
  return {
    id: row.id,
    spaceId: row.space_id,
    previousActiveNodeId: row.previous_active_node_id,
    activeNodeId: row.active_node_id,
    previousEpoch: Number(row.previous_epoch),
    epoch: Number(row.epoch),
    status: row.status,
    detectedAt: Number(row.detected_at),
    reconciledAt: row.reconciled_at === null ? null : Number(row.reconciled_at)
  };
}

function presentRecovery(row) {
  if (!row) return null;
  return {
    id: row.id,
    spaceId: row.space_id,
    takeoverId: row.takeover_id,
    authorityNodeId: row.authority_node_id,
    targetNodeId: row.target_node_id,
    sourceEpoch: Number(row.source_epoch),
    targetEpoch: Number(row.target_epoch),
    status: row.status,
    snapshotHash: row.snapshot_hash || "",
    errorCode: row.error_code || "",
    errorMessage: row.error_message || "",
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
    completedAt: row.completed_at === null ? null : Number(row.completed_at)
  };
}

function presentPeerRecovery(row) {
  return {
    ...presentRecovery(row),
    signedControl: row.control_json
      ? {
          control: JSON.parse(row.control_json),
          authenticationTag: row.control_signature
        }
      : null,
    snapshotReady: Boolean(row.encrypted_snapshot_json && row.payload_hash),
    payloadHash: row.payload_hash || ""
  };
}

function parseObject(value, label) {
  try {
    const parsed = JSON.parse(String(value || ""));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid");
    return parsed;
  } catch {
    throw new HttpError(
      500,
      "DIVERGENCE_EVIDENCE_CORRUPTED",
      `${label}已经损坏，无法生成恢复证据包。`
    );
  }
}

function signCanonical(value, key) {
  return createHmac("sha256", key)
    .update(canonicalStringify(value), "utf8")
    .digest("hex");
}

function safeTag(left, right) {
  const received = String(left || "").toLowerCase();
  return /^[a-f0-9]{64}$/.test(received) &&
    timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(right, "hex"));
}

function decodeChunk(value) {
  if (typeof value !== "string" || value.length % 4 !== 0) {
    throw new HttpError(400, "DIVERGENCE_SNAPSHOT_CHUNK_INVALID", "恢复快照分块不是有效 Base64。");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new HttpError(400, "DIVERGENCE_SNAPSHOT_CHUNK_INVALID", "恢复快照分块 Base64 不规范。");
  }
  return bytes;
}

function safeInteger(value, field, minimum) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < minimum) {
    throw new HttpError(400, "DIVERGENCE_RANGE_INVALID", `恢复字段 ${field} 无效。`);
  }
  return result;
}

function safeMediaPath(root, fileName) {
  const name = String(fileName || "");
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.includes("..")) {
    throw new HttpError(409, "DIVERGENCE_MEDIA_PATH_INVALID", "恢复媒体文件名无效。");
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(root, name);
  if (path.dirname(resolved) !== resolvedRoot) {
    throw new HttpError(409, "DIVERGENCE_MEDIA_PATH_INVALID", "恢复媒体路径越界。");
  }
  return resolved;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function recoveryConflict(message) {
  return new HttpError(409, "DIVERGENCE_RECOVERY_STATE_CONFLICT", message);
}

module.exports = {
  DivergenceRecoveryService,
  EVIDENCE_FORMAT,
  EVIDENCE_FORMAT_VERSION,
  MAX_RECOVERY_CHUNK_BYTES,
  RECOVERY_FORMAT,
  RECOVERY_FORMAT_VERSION
};
