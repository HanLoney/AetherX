const {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual
} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { HttpError } = require("../../lib/http-error");
const { isPristineAccountProfile } = require("../auth/account-defaults");
const {
  DIGEST_ALGORITHM,
  FORMAT_VERSION,
  TABLES,
  continuityDigest,
  validateMetadata
} = require("../archive/archive-format");
const {
  canonicalStringify,
  sha256Canonical,
  validateOperation
} = require("./operation-codec");

const SNAPSHOT_FORMAT_VERSION = 1;
const MAX_SNAPSHOT_ATTEMPTS = 3;
const MAX_STRUCTURED_PAYLOAD_BYTES = 64 * 1024 * 1024;
const MAX_ENCRYPTED_PAYLOAD_BYTES = 96 * 1024 * 1024;
const MAX_SNAPSHOT_PAYLOAD_CHUNK_BYTES = 512 * 1024;
const SNAPSHOT_ENCRYPTION = "A256GCM";
const MAX_BLOB_CHUNK_BYTES = 1024 * 1024;
const EMPTY_SHA256 = createHash("sha256").update(Buffer.alloc(0)).digest("hex");

class IntegrityService {
  constructor({
    repository,
    replicationRepository,
    clusterService,
    clusterRepository,
    archiveService,
    spaceKeyService,
    now = () => Date.now()
  }) {
    this.repository = repository;
    this.replicationRepository = replicationRepository;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.archiveService = archiveService;
    this.spaceKeyService = spaceKeyService;
    this.now = now;
  }

  async createSnapshotManifest(userId, requestedByNodeId) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.local_node_id !== context.active_node_id) {
      throw new HttpError(
        409,
        "SNAPSHOT_SOURCE_NOT_ACTIVE",
        "只有当前活动 Hub 可以生成 Bootstrap 快照。"
      );
    }
    const peer = this.clusterRepository.findNode(context.space_id, requestedByNodeId);
    if (!peer || peer.revoked_at !== null || peer.id === context.local_node_id) {
      throw new HttpError(403, "PEER_NOT_TRUSTED", "请求快照的 Hub 节点无效。");
    }
    return this.archiveService.withUserLock(userId, async () => {
      this.archiveService.requireAgentIdle(userId);
      for (let attempt = 1; attempt <= MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
        const before = this.captureBoundary(userId, context.space_id);
        const snapshot = await this.archiveService.collectSnapshot(userId);
        const after = this.captureBoundary(userId, context.space_id);
        if (!sameBoundary(before, after)) {
          if (attempt < MAX_SNAPSHOT_ATTEMPTS) continue;
          throw new HttpError(
            409,
            "SNAPSHOT_SOURCE_UNSTABLE",
            "生成快照期间数据持续变化，请稍后重试。"
          );
        }
        const id = randomUUID();
        const createdAt = this.now();
        const manifest = buildManifest({
          snapshot,
          context,
          boundary: after,
          now: createdAt
        });
        const metadata = buildArchiveMetadata(snapshot, createdAt);
        const replication = this.collectReplicationState(context.space_id, after);
        const packageValue = {
          formatVersion: SNAPSHOT_FORMAT_VERSION,
          snapshotId: id,
          manifest,
          metadata,
          replication
        };
        const payloadBytes = Buffer.byteLength(canonicalStringify(packageValue), "utf8");
        if (payloadBytes > MAX_STRUCTURED_PAYLOAD_BYTES) {
          throw new HttpError(
            413,
            "SNAPSHOT_PAYLOAD_TOO_LARGE",
            "结构化快照超过当前单包限制，需要使用分块 Bootstrap。"
          );
        }
        const aad = {
          snapshotId: id,
          spaceId: context.space_id,
          sourceNodeId: context.local_node_id,
          requestedByNodeId: peer.id,
          epoch: Number(context.epoch),
          manifestHash: manifest.manifestHash
        };
        const envelope = encryptPayload(
          packageValue,
          this.spaceKeyService.ensure(context.space_id).key,
          aad
        );
        const payloadHash = sha256Canonical(envelope);
        const encryptedBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
        if (encryptedBytes > MAX_ENCRYPTED_PAYLOAD_BYTES) {
          throw new HttpError(
            413,
            "SNAPSHOT_PAYLOAD_TOO_LARGE",
            "加密后的结构化快照超过当前单包限制，需要使用分块 Bootstrap。"
          );
        }
        return this.repository.transaction(() => {
          const stored = this.repository.saveSnapshot({
            id,
            spaceId: context.space_id,
            sourceNodeId: context.local_node_id,
            requestedByNodeId: peer.id,
            epoch: Number(context.epoch),
            boundary: after,
            recordsRoot: manifest.recordsRoot,
            blobsRoot: manifest.blobsRoot,
            manifestHash: manifest.manifestHash,
            manifest,
            status: "payload_ready",
            createdAt: manifest.createdAt
          });
          this.repository.savePayload({
            snapshotId: id,
            spaceId: context.space_id,
            envelope,
            payloadHash,
            byteSize: encryptedBytes,
            createdAt
          });
          return {
            ...stored,
            payloadReady: true,
            payloadBytes: encryptedBytes,
            payloadHash
          };
        });
      }
      throw new HttpError(500, "SNAPSHOT_CREATE_FAILED", "无法生成 Bootstrap 快照。");
    });
  }

  captureBoundary(userId, spaceId) {
    return {
      syncCursor: this.repository.currentSyncCursor(userId),
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

  collectReplicationState(spaceId, boundary) {
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
        if (!batch.length) {
          throw new HttpError(409, "SNAPSHOT_OPERATION_GAP", "快照边界内的 Operation 存在缺口。");
        }
        operations.push(...batch);
        after = batch.at(-1).originSequence;
      }
    }
    return {
      operations,
      entityVersions: this.repository.listEntityVersions(spaceId)
    };
  }

  getSnapshotPayload(userId, peerNodeId, snapshotId) {
    const context = this.clusterService.ensureSpace(userId);
    const payload = this.repository.findPayload(String(snapshotId || ""));
    if (
      !payload ||
      payload.spaceId !== context.space_id ||
      payload.requestedByNodeId !== peerNodeId
    ) {
      throw new HttpError(404, "SNAPSHOT_NOT_FOUND", "Bootstrap 快照不存在。");
    }
    return payload;
  }

  getSnapshotPayloadChunk(userId, peerNodeId, snapshotId, input = {}) {
    const payload = this.getSnapshotPayload(userId, peerNodeId, snapshotId);
    const bytes = Buffer.from(canonicalStringify(payload.envelope), "utf8");
    const offset = parseBlobInteger(input.offset, "offset", 0);
    const requestedLength = parseBlobInteger(
      input.length,
      "length",
      MAX_SNAPSHOT_PAYLOAD_CHUNK_BYTES
    );
    if (requestedLength < 1 || requestedLength > MAX_SNAPSHOT_PAYLOAD_CHUNK_BYTES) {
      throw new HttpError(
        400,
        "SNAPSHOT_PAYLOAD_RANGE_INVALID",
        "结构快照分块大小无效。"
      );
    }
    if (offset > bytes.length) {
      throw new HttpError(
        416,
        "SNAPSHOT_PAYLOAD_RANGE_INVALID",
        "结构快照分块偏移超出数据范围。"
      );
    }
    const chunk = bytes.subarray(
      offset,
      Math.min(bytes.length, offset + requestedLength)
    );
    const nextOffset = offset + chunk.length;
    return {
      snapshotId: payload.snapshotId,
      offset,
      nextOffset,
      byteSize: bytes.length,
      payloadHash: payload.payloadHash,
      chunkHash: createHash("sha256").update(chunk).digest("hex"),
      data: chunk.toString("base64"),
      complete: nextOffset === bytes.length
    };
  }

  getSnapshotBlobChunk(userId, peerNodeId, snapshotId, mediaId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.local_node_id !== context.active_node_id) {
      throw new HttpError(409, "SNAPSHOT_SOURCE_NOT_ACTIVE", "只有活动 Hub 可以提供 Bootstrap 原图。");
    }
    const payload = this.getSnapshotPayload(userId, peerNodeId, snapshotId);
    const packageValue = decryptPayload(
      payload.envelope,
      this.spaceKeyService.ensure(context.space_id).key
    );
    const metadata = validateMetadata(packageValue?.metadata);
    const item = metadata.media.find((candidate) => candidate.id === String(mediaId || ""));
    if (!item || packageValue.snapshotId !== payload.snapshotId) {
      throw new HttpError(404, "SNAPSHOT_BLOB_NOT_FOUND", "Bootstrap 原图不存在。");
    }
    const offset = parseBlobInteger(input.offset, "offset", 0);
    const requestedLength = parseBlobInteger(input.length, "length", MAX_BLOB_CHUNK_BYTES);
    if (requestedLength < 1 || requestedLength > MAX_BLOB_CHUNK_BYTES) {
      throw new HttpError(400, "SNAPSHOT_BLOB_RANGE_INVALID", "原图分块大小无效。");
    }
    if (offset > item.byteSize) {
      throw new HttpError(416, "SNAPSHOT_BLOB_RANGE_INVALID", "原图分块偏移超出文件范围。");
    }
    const filePath = safeSingleLevelPath(this.archiveService.mediaDir, item.fileName);
    if (!fs.existsSync(filePath)) {
      throw new HttpError(409, "SNAPSHOT_BLOB_MISSING", "快照中的原图已经不存在。");
    }
    const stat = fs.statSync(filePath);
    if (stat.size !== item.byteSize) {
      throw new HttpError(409, "SNAPSHOT_BLOB_CHANGED", "快照中的原图大小已经变化，请重新生成快照。");
    }
    const length = Math.min(requestedLength, item.byteSize - offset);
    const bytes = Buffer.alloc(length);
    if (length) {
      const descriptor = fs.openSync(filePath, "r");
      try {
        fs.readSync(descriptor, bytes, 0, length, offset);
      } finally {
        fs.closeSync(descriptor);
      }
    }
    return {
      bytes,
      mediaId: item.id,
      contentHash: item.contentHash,
      chunkHash: createHash("sha256").update(bytes).digest("hex"),
      offset,
      byteSize: item.byteSize
    };
  }

  stageSnapshotPayload(userId, sourceNodeId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    if (sourceNodeId !== context.active_node_id || sourceNodeId === context.local_node_id) {
      throw new HttpError(403, "SNAPSHOT_SOURCE_INVALID", "Bootstrap 数据必须来自当前活动 Hub。");
    }
    const envelope = input.envelope;
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) {
      throw new HttpError(400, "SNAPSHOT_PAYLOAD_INVALID", "Bootstrap 数据包格式无效。");
    }
    const payloadHash = sha256Canonical(envelope);
    const existing = this.repository.findStaging(envelope?.aad?.snapshotId);
    if (existing) {
      if (existing.payloadHash !== payloadHash) {
        throw new HttpError(409, "SNAPSHOT_STAGE_CONFLICT", "同一快照 ID 对应了不同的数据包。");
      }
      return existing;
    }
    const packageValue = decryptPayload(
      envelope,
      this.spaceKeyService.ensure(context.space_id).key
    );
    const verified = verifyPackage({
      packageValue,
      envelope,
      context,
      sourceNodeId,
      clusterRepository: this.clusterRepository,
      syncKey: this.spaceKeyService.ensure(context.space_id).key
    });
    const now = this.now();
    const blobDescriptors = verified.metadata.media.map((item) => {
      if (item.byteSize === 0 && item.contentHash !== EMPTY_SHA256) {
        throw new HttpError(400, "SNAPSHOT_BLOB_HASH_INVALID", "空原图的内容摘要无效。");
      }
      return {
        mediaId: item.id,
        contentHash: item.contentHash,
        byteSize: item.byteSize,
        receivedBytes: 0,
        tempFileName: `${randomUUID()}.part`,
        status: item.byteSize === 0 ? "verified" : "pending"
      };
    });
    const status = blobDescriptors.every((item) => item.status === "verified")
      ? "verified"
      : "waiting_blobs";
    ensureBlobStageDirectory(this.archiveService.tempDir, verified.manifest.snapshotId);
    return this.repository.transaction(() => {
      const staged = this.repository.stagePayload({
        snapshotId: verified.manifest.snapshotId,
        spaceId: context.space_id,
        sourceNodeId,
        manifestHash: verified.manifest.manifestHash,
        recordsRoot: verified.manifest.recordsRoot,
        blobsRoot: verified.manifest.blobsRoot,
        boundary: verified.manifest.boundary,
        envelope,
        payloadHash,
        status,
        createdAt: verified.manifest.createdAt,
        verifiedAt: now
      });
      this.repository.initializeBlobStaging(staged.snapshotId, blobDescriptors, now);
      return { ...staged, blobs: this.repository.listBlobStaging(staged.snapshotId) };
    });
  }

  async receiveSnapshotBlobChunk(userId, sourceNodeId, snapshotId, mediaId, input = {}) {
    return this.archiveService.withUserLock(userId, () =>
      this.receiveSnapshotBlobChunkUnlocked(userId, sourceNodeId, snapshotId, mediaId, input)
    );
  }

  async receiveSnapshotBlobChunkUnlocked(userId, sourceNodeId, snapshotId, mediaId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    if (sourceNodeId !== context.active_node_id || sourceNodeId === context.local_node_id) {
      throw new HttpError(403, "SNAPSHOT_SOURCE_INVALID", "原图分块必须来自当前活动 Hub。");
    }
    const staging = this.repository.findStaging(String(snapshotId || ""));
    if (!staging || staging.spaceId !== context.space_id || staging.sourceNodeId !== sourceNodeId) {
      throw new HttpError(404, "SNAPSHOT_STAGE_NOT_FOUND", "Bootstrap staging 不存在。");
    }
    if (!["waiting_blobs", "verified"].includes(staging.status)) {
      throw new HttpError(409, "SNAPSHOT_STAGE_NOT_READY", "当前 Bootstrap 不再接收原图分块。");
    }
    const blob = this.repository.findBlobStaging(staging.snapshotId, String(mediaId || ""));
    if (!blob) throw new HttpError(404, "SNAPSHOT_BLOB_NOT_FOUND", "Bootstrap 原图不存在。");
    const offset = parseBlobInteger(input.offset, "offset", -1);
    const bytes = decodeBlobChunk(input.data);
    if (!bytes.length || bytes.length > MAX_BLOB_CHUNK_BYTES) {
      throw new HttpError(400, "SNAPSHOT_BLOB_CHUNK_INVALID", "原图分块大小无效。");
    }
    const chunkHash = String(input.chunkHash || "").toLowerCase();
    const actualChunkHash = createHash("sha256").update(bytes).digest("hex");
    if (!/^[a-f0-9]{64}$/.test(chunkHash) || chunkHash !== actualChunkHash) {
      throw new HttpError(400, "SNAPSHOT_BLOB_CHUNK_HASH_MISMATCH", "原图分块校验失败。");
    }
    if (offset + bytes.length > blob.byteSize) {
      throw new HttpError(416, "SNAPSHOT_BLOB_RANGE_INVALID", "原图分块超出文件范围。");
    }

    const directory = ensureBlobStageDirectory(this.archiveService.tempDir, staging.snapshotId);
    const tempPath = safeSingleLevelPath(directory, blob.tempFileName);
    let receivedBytes = reconcileBlobFile(tempPath, blob.receivedBytes);
    if (receivedBytes !== blob.receivedBytes) {
      this.repository.updateBlobProgress(
        staging.snapshotId,
        blob.mediaId,
        receivedBytes,
        "pending",
        this.now()
      );
    }
    if (offset < receivedBytes) {
      if (offset + bytes.length > receivedBytes || !fileRangeEquals(tempPath, offset, bytes)) {
        throw new HttpError(409, "SNAPSHOT_BLOB_OFFSET_CONFLICT", "重复分块与已接收内容不一致。");
      }
      return presentBlobProgress({ ...blob, receivedBytes }, true);
    }
    if (offset !== receivedBytes) {
      throw new HttpError(
        409,
        "SNAPSHOT_BLOB_OFFSET_MISMATCH",
        "原图分块必须从已确认偏移继续传输。",
        { expectedOffset: receivedBytes }
      );
    }
    appendBlobChunk(tempPath, bytes, offset);
    receivedBytes += bytes.length;
    let status = "pending";
    if (receivedBytes === blob.byteSize) {
      if (await hashFile(tempPath) !== blob.contentHash) {
        fs.rmSync(tempPath, { force: true });
        this.repository.updateBlobProgress(
          staging.snapshotId,
          blob.mediaId,
          0,
          "pending",
          this.now()
        );
        throw new HttpError(409, "SNAPSHOT_BLOB_HASH_MISMATCH", "完整原图校验失败，已丢弃并等待重传。");
      }
      status = "verified";
    }
    const updated = this.repository.transaction(() => {
      const result = this.repository.updateBlobProgress(
        staging.snapshotId,
        blob.mediaId,
        receivedBytes,
        status,
        this.now()
      );
      if (status === "verified" && this.repository.countUnverifiedBlobs(staging.snapshotId) === 0) {
        this.repository.updateStagingStatus(staging.snapshotId, "verified", this.now());
      }
      return result;
    });
    return presentBlobProgress(updated, false);
  }

  async restoreStaging(userId, snapshotId) {
    const normalizedId = String(snapshotId || "").trim();
    const context = this.clusterService.ensureSpace(userId);
    const staging = this.repository.findStaging(normalizedId);
    if (!staging || staging.spaceId !== context.space_id) {
      throw new HttpError(404, "SNAPSHOT_STAGE_NOT_FOUND", "Bootstrap staging 不存在。");
    }
    if (staging.status === "restored") return { ...staging, restored: true };
    if (staging.status !== "verified") {
      throw new HttpError(
        409,
        "SNAPSHOT_STAGE_NOT_READY",
        staging.status === "waiting_blobs"
          ? "Bootstrap 仍在等待媒体 Blob。"
          : "Bootstrap staging 尚未通过完整性验证。"
      );
    }
    return this.archiveService.withUserLock(userId, async () => {
      this.archiveService.requireAgentIdle(userId);
      const current = this.repository.findStaging(normalizedId);
      if (current?.status === "restored") return { ...current, restored: true };
      if (current?.status !== "verified") {
        throw new HttpError(409, "SNAPSHOT_STAGE_NOT_READY", "Bootstrap staging 状态已经变化。");
      }
      if (this.repository.replicationStateCount(context.space_id) !== 0) {
        throw new HttpError(
          409,
          "SNAPSHOT_TARGET_DIRTY",
          "目标 Hub 已经存在复制状态，不能覆盖式恢复 Bootstrap。"
        );
      }
      this.assertTargetBusinessDataEmpty(userId);
      const envelope = this.repository.loadStagingPayload(normalizedId);
      const packageValue = decryptPayload(
        envelope,
        this.spaceKeyService.ensure(context.space_id).key
      );
      const verified = verifyPackage({
        packageValue,
        envelope,
        context,
        sourceNodeId: current.sourceNodeId,
        clusterRepository: this.clusterRepository,
        syncKey: this.spaceKeyService.ensure(context.space_id).key
      });
      this.archiveService.validateRecordShape(verified.metadata.records);
      this.archiveService.validateConflicts(userId, verified.metadata.records);
      const stagedMedia = await this.prepareStagedMedia(normalizedId, verified.metadata);
      try {
        const restored = this.archiveService.replaceUserData(
          userId,
          verified.metadata,
          stagedMedia.items,
          {
          beforeCommit: () => {
            if (this.repository.replicationStateCount(context.space_id) !== 0) {
              throw new HttpError(409, "SNAPSHOT_TARGET_DIRTY", "目标复制状态在恢复期间发生变化。");
            }
            const appliedAt = this.now();
            for (const operation of verified.replication.operations) {
              this.replicationRepository.insertOperation(operation);
              this.replicationRepository.markApplied(
                operation.operationId,
                context.space_id,
                appliedAt
              );
            }
            for (const item of verified.replication.entityVersions) {
              this.replicationRepository.setEntityVersion(
                context.space_id,
                item.entityType,
                item.entityId,
                item.version,
                item.updatedAt
              );
            }
            const result = this.repository.updateStagingStatus(
              normalizedId,
              "restored",
              appliedAt
            );
            return {
              snapshotId: normalizedId,
              status: result.status,
              recordsRoot: result.recordsRoot,
              blobsRoot: result.blobsRoot,
              boundary: result.boundary,
              importedOperations: verified.replication.operations.length,
              importedEntityVersions: verified.replication.entityVersions.length
            };
          }
          }
        );
        fs.rmSync(stagedMedia.sourceDirectory, { recursive: true, force: true });
        return { ...restored, restored: true };
      } finally {
        fs.rmSync(stagedMedia.restoreDirectory, { recursive: true, force: true });
      }
    });
  }

  getStagingStatus(userId, snapshotId) {
    const context = this.clusterService.ensureSpace(userId);
    const staging = this.repository.findStaging(String(snapshotId || ""));
    if (!staging || staging.spaceId !== context.space_id) {
      throw new HttpError(404, "SNAPSHOT_STAGE_NOT_FOUND", "Bootstrap staging 不存在。");
    }
    const blobs = this.repository.listBlobStaging(staging.snapshotId).map((blob) => ({
      mediaId: blob.mediaId,
      contentHash: blob.contentHash,
      byteSize: blob.byteSize,
      receivedBytes: blob.receivedBytes,
      status: blob.status,
      complete: blob.status === "verified",
      updatedAt: blob.updatedAt
    }));
    return {
      snapshotId: staging.snapshotId,
      status: staging.status,
      sourceNodeId: staging.sourceNodeId,
      createdAt: staging.createdAt,
      verifiedAt: staging.verifiedAt,
      blobs: {
        total: blobs.length,
        complete: blobs.filter((blob) => blob.complete).length,
        totalBytes: blobs.reduce((sum, blob) => sum + blob.byteSize, 0),
        receivedBytes: blobs.reduce((sum, blob) => sum + blob.receivedBytes, 0),
        items: blobs
      }
    };
  }

  async prepareStagedMedia(snapshotId, metadata) {
    const rows = new Map(
      this.repository.listBlobStaging(snapshotId).map((item) => [item.mediaId, item])
    );
    if (rows.size !== metadata.media.length) {
      throw new HttpError(409, "SNAPSHOT_BLOBS_REQUIRED", "Bootstrap 原图尚未完整接收。");
    }
    const sourceDirectory = ensureBlobStageDirectory(this.archiveService.tempDir, snapshotId);
    const restoreDirectory = path.join(
      this.archiveService.tempDir,
      `bootstrap-restore-${randomUUID()}`
    );
    fs.mkdirSync(restoreDirectory, { recursive: false });
    const items = [];
    try {
      for (const item of metadata.media) {
        const row = rows.get(item.id);
        if (
          !row ||
          row.status !== "verified" ||
          row.byteSize !== item.byteSize ||
          row.contentHash !== item.contentHash
        ) {
          throw new HttpError(409, "SNAPSHOT_BLOBS_REQUIRED", "Bootstrap 原图尚未通过完整校验。");
        }
        const sourcePath = safeSingleLevelPath(sourceDirectory, row.tempFileName);
        if (item.byteSize === 0 && !fs.existsSync(sourcePath)) {
          fs.writeFileSync(sourcePath, Buffer.alloc(0), { flag: "wx", mode: 0o600 });
        }
        if (!fs.existsSync(sourcePath) || fs.statSync(sourcePath).size !== item.byteSize) {
          throw new HttpError(409, "SNAPSHOT_BLOB_MISSING", "已校验的 Bootstrap 原图文件缺失。");
        }
        if (await hashFile(sourcePath) !== item.contentHash) {
          throw new HttpError(409, "SNAPSHOT_BLOB_HASH_MISMATCH", "Bootstrap 原图在恢复前校验失败。");
        }
        const stagePath = safeSingleLevelPath(restoreDirectory, item.fileName);
        fs.copyFileSync(sourcePath, stagePath, fs.constants.COPYFILE_EXCL);
        items.push({ ...item, stagePath });
      }
      return { items, sourceDirectory, restoreDirectory };
    } catch (error) {
      fs.rmSync(restoreDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  assertTargetBusinessDataEmpty(userId) {
    const records = this.archiveService.collectRecords(userId);
    const occupied = TABLES.filter((table) => {
      const rows = records[table] || [];
      if (!rows.length) return false;
      if (
        rows.length === 1 &&
        isPristineAccountProfile(this.archiveService.database, table, userId)
      ) {
        return false;
      }
      return true;
    });
    if (occupied.length) {
      throw new HttpError(
        409,
        "SNAPSHOT_TARGET_DIRTY",
        "目标 Hub 已经存在本地业务数据，不能覆盖式恢复 Bootstrap。",
        { tables: occupied }
      );
    }
  }

  async createCompletionProof(userId, snapshotId) {
    const context = this.clusterService.ensureSpace(userId);
    const staging = this.repository.findStaging(String(snapshotId || ""));
    if (
      !staging ||
      staging.spaceId !== context.space_id ||
      !["restored", "completed"].includes(staging.status)
    ) {
      throw new HttpError(409, "BOOTSTRAP_NOT_RESTORED", "Bootstrap 尚未完成结构化恢复。");
    }
    return this.withStableIntegrity(userId, context, (integrity) => ({
      snapshotId: staging.snapshotId,
      spaceId: context.space_id,
      nodeId: context.local_node_id,
      epoch: Number(context.epoch),
      recordsRoot: integrity.recordsRoot,
      blobsRoot: integrity.blobsRoot,
      operationHeads: integrity.boundary.operations,
      generatedAt: this.now()
    }));
  }

  async createSwitchPreflightProof(userId, requesterNodeId = "") {
    const context = this.clusterService.ensureSpace(userId);
    if (!["stable", "final_sync", "integrity_check"].includes(context.state)) {
      throw new HttpError(
        409,
        "SWITCH_CLUSTER_NOT_STABLE",
        "集群状态不稳定，不能执行切换预检。"
      );
    }
    const localNode = this.clusterRepository.findNode(
      context.space_id,
      context.local_node_id
    );
    if (requesterNodeId) {
      const requester = this.clusterRepository.findNode(
        context.space_id,
        requesterNodeId
      );
      if (
        !requester ||
        requester.revoked_at !== null ||
        requester.id !== context.active_node_id ||
        context.local_node_id === context.active_node_id ||
        localNode?.status !== "standby"
      ) {
        throw new HttpError(
          403,
          "SWITCH_PREFLIGHT_PEER_INVALID",
          "只有当前活动 Hub 可以请求备用 Hub 的切换预检。"
        );
      }
    } else if (
      context.local_node_id !== context.active_node_id ||
      localNode?.status !== "active"
    ) {
      throw new HttpError(
        409,
        "SWITCH_SOURCE_NOT_ACTIVE",
        "只有当前活动 Hub 可以发起切换预检。"
      );
    }
    assertDatabaseHealthy(this.archiveService.database);
    return this.withStableIntegrity(userId, context, (integrity, snapshot) => {
      const pendingMedia = this.archiveService.database.prepare(
        `SELECT COUNT(*) AS count
         FROM replication_media_staging
         WHERE space_id = ?`
      ).get(context.space_id);
      const busyBootstrap = this.archiveService.database.prepare(
        `SELECT COUNT(*) AS count
         FROM replication_bootstrap_staging
         WHERE space_id = ? AND status <> 'completed'`
      ).get(context.space_id);
      const proof = {
        protocolVersion: Number(context.protocol_version),
        schemaVersion: Number(context.schema_version),
        spaceId: context.space_id,
        nodeId: context.local_node_id,
        activeNodeId: context.active_node_id,
        epoch: Number(context.epoch),
        clusterState: context.state,
        role: context.local_node_id === context.active_node_id
          ? "active"
          : "standby",
        nodeStatus: localNode.status,
        databaseHealthy: true,
        providerCredentialsReadable: true,
        agentIdle: true,
        pendingMediaCount: Number(pendingMedia.count),
        busyBootstrapCount: Number(busyBootstrap.count),
        recordsRoot: switchRecordsRoot(snapshot),
        blobsRoot: integrity.blobsRoot,
        operationHeads: integrity.boundary.operations,
        generatedAt: this.now()
      };
      return {
        proof,
        authenticationTag: signCompletionReceipt(
          proof,
          this.spaceKeyService.ensure(context.space_id).key
        )
      };
    });
  }

  verifySwitchPreflightProof(userId, targetNodeId, signed = {}) {
    const context = this.clusterService.ensureSpace(userId);
    const proof = signed.proof;
    const generatedAt = Number(proof?.generatedAt);
    const fresh = Number.isSafeInteger(generatedAt) &&
      Math.abs(this.now() - generatedAt) <= 30_000;
    const valid = proof?.spaceId === context.space_id &&
      proof?.nodeId === targetNodeId &&
      Number(proof?.epoch) === Number(context.epoch) &&
      fresh &&
      verifyCompletionReceipt(
        proof,
        signed.authenticationTag,
        this.spaceKeyService.ensure(context.space_id).key
      );
    if (!valid) {
      throw new HttpError(
        409,
        "SWITCH_PREFLIGHT_PROOF_INVALID",
        "备用 Hub 的切换预检证明无效或已经过期。"
      );
    }
    return proof;
  }

  async verifyCompletionProof(userId, peerNodeId, proof = {}) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.local_node_id !== context.active_node_id) {
      throw new HttpError(409, "BOOTSTRAP_SOURCE_NOT_ACTIVE", "只有活动 Hub 可以确认备用节点。");
    }
    const snapshot = this.repository.findSnapshot(String(proof.snapshotId || ""));
    if (
      !snapshot ||
      snapshot.spaceId !== context.space_id ||
      snapshot.requestedByNodeId !== peerNodeId ||
      !["payload_ready", "standby_pending"].includes(snapshot.status) ||
      proof.spaceId !== context.space_id ||
      proof.nodeId !== peerNodeId ||
      Number(proof.epoch) !== Number(context.epoch)
    ) {
      throw new HttpError(409, "BOOTSTRAP_PROOF_INVALID", "Bootstrap 完成证明与配对快照不匹配。");
    }
    return this.withStableIntegrity(userId, context, (integrity) => {
      assertCompletionMatches(proof, integrity);
      const completedAt = this.now();
      const receipt = {
        snapshotId: snapshot.id,
        spaceId: context.space_id,
        nodeId: peerNodeId,
        epoch: Number(context.epoch),
        recordsRoot: integrity.recordsRoot,
        blobsRoot: integrity.blobsRoot,
        operationHeads: integrity.boundary.operations,
        completedAt
      };
      const authenticationTag = signCompletionReceipt(
        receipt,
        this.spaceKeyService.ensure(context.space_id).key
      );
      this.repository.transaction(() => {
        this.clusterRepository.updateNodeStatus(
          context.space_id,
          peerNodeId,
          "standby_pending",
          completedAt
        );
        this.repository.updateSnapshotStatus(snapshot.id, "standby_pending");
      });
      return { receipt, authenticationTag };
    });
  }

  async finalizeLocalStandby(userId, snapshotId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    const staging = this.repository.findStaging(String(snapshotId || ""));
    const receipt = input.receipt;
    const receiptValid = receipt?.snapshotId === staging?.snapshotId &&
      receipt?.spaceId === context.space_id &&
      receipt?.nodeId === context.local_node_id &&
      Number(receipt?.epoch) === Number(context.epoch) &&
      verifyCompletionReceipt(
        receipt,
        input.authenticationTag,
        this.spaceKeyService.ensure(context.space_id).key
      );
    if (staging?.status === "completed" && receiptValid) {
      return { ...staging, localNodeStatus: "standby" };
    }
    if (
      !staging ||
      staging.spaceId !== context.space_id ||
      staging.status !== "restored" ||
      !receiptValid
    ) {
      throw new HttpError(409, "BOOTSTRAP_RECEIPT_INVALID", "活动 Hub 的 Bootstrap 确认回执无效。");
    }
    return this.withStableIntegrity(userId, context, (integrity) => {
      assertCompletionMatches(receipt, integrity);
      const finalizedAt = this.now();
      return this.repository.transaction(() => {
        this.clusterRepository.updateNodeStatus(
          context.space_id,
          context.local_node_id,
          "standby",
          finalizedAt
        );
        const result = this.repository.updateStagingStatus(
          staging.snapshotId,
          "completed",
          finalizedAt
        );
        return { ...result, localNodeStatus: "standby" };
      });
    });
  }

  acknowledgeStandby(userId, peerNodeId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    const receipt = input.receipt;
    const snapshot = this.repository.findSnapshot(String(receipt?.snapshotId || ""));
    const peer = this.clusterRepository.findNode(context.space_id, peerNodeId);
    const receiptValid = receipt?.spaceId === context.space_id &&
      receipt?.nodeId === peerNodeId &&
      verifyCompletionReceipt(
        receipt,
        input.authenticationTag,
        this.spaceKeyService.ensure(context.space_id).key
      );
    if (
      context.local_node_id === context.active_node_id &&
      snapshot?.status === "completed" &&
      snapshot.requestedByNodeId === peerNodeId &&
      peer?.status === "standby" &&
      receiptValid
    ) {
      return {
        snapshotId: snapshot.id,
        nodeId: peer.id,
        nodeStatus: peer.status,
        snapshotStatus: snapshot.status,
        completedAt: snapshot.completedAt
      };
    }
    if (
      context.local_node_id !== context.active_node_id ||
      !snapshot ||
      snapshot.status !== "standby_pending" ||
      snapshot.requestedByNodeId !== peerNodeId ||
      !peer ||
      peer.status !== "standby_pending" ||
      !receiptValid
    ) {
      throw new HttpError(409, "BOOTSTRAP_FINALIZE_INVALID", "备用 Hub 完成确认无效。");
    }
    const completedAt = this.now();
    return this.repository.transaction(() => {
      const node = this.clusterRepository.updateNodeStatus(
        context.space_id,
        peerNodeId,
        "standby",
        completedAt
      );
      const completed = this.repository.completeSnapshot(snapshot.id, completedAt);
      this.repository.deleteUnfinishedSnapshotsForNode(
        context.space_id,
        peerNodeId,
        completed.id
      );
      return {
        snapshotId: completed.id,
        nodeId: node.id,
        nodeStatus: node.status,
        snapshotStatus: completed.status,
        completedAt
      };
    });
  }

  async withStableIntegrity(userId, context, action) {
    return this.archiveService.withUserLock(userId, async () => {
      this.archiveService.requireAgentIdle(userId);
      for (let attempt = 1; attempt <= MAX_SNAPSHOT_ATTEMPTS; attempt += 1) {
        const before = this.captureBoundary(userId, context.space_id);
        const snapshot = await this.archiveService.collectSnapshot(userId);
        const after = this.captureBoundary(userId, context.space_id);
        if (!sameBoundary(before, after)) {
          if (attempt < MAX_SNAPSHOT_ATTEMPTS) continue;
          throw new HttpError(
            409,
            "BOOTSTRAP_STATE_UNSTABLE",
            "校验期间数据持续变化，请完成同步后重试。"
          );
        }
        const manifest = buildManifest({
          snapshot,
          context,
          boundary: after,
          now: this.now(),
          sourceNodeId: context.active_node_id
        });
        return action({ ...manifest, boundary: after }, snapshot);
      }
      throw new HttpError(500, "BOOTSTRAP_VERIFY_FAILED", "无法完成副本完整性校验。");
    });
  }
}

function buildManifest({ snapshot, context, boundary, now, sourceNodeId }) {
  const tableEntries = [
    ...TABLES.map((name) => tableManifest(name, snapshot.records[name] || [])),
    tableManifest("$account", [snapshot.account || {}]),
    tableManifest("$credentials", [snapshot.credentials || {}])
  ].sort((left, right) => compareText(left.name, right.name));
  const recordsRoot = merkleRoot(
    tableEntries.map((table) => sha256Canonical(table))
  );
  const blobs = snapshot.media.map((item) => ({
    id: String(item.id),
    mimeType: String(item.mimeType),
    byteSize: Number(item.byteSize),
    contentHash: String(item.contentHash)
  })).sort((left, right) => compareText(left.id, right.id));
  const blobsRoot = merkleRoot(blobs.map((blob) => sha256Canonical(blob)));
  const base = {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    protocolVersion: Number(context.protocol_version),
    schemaVersion: Number(context.schema_version),
    spaceId: context.space_id,
    sourceNodeId: sourceNodeId || context.local_node_id,
    epoch: Number(context.epoch),
    boundary,
    recordsRoot,
    blobsRoot,
    tables: tableEntries,
    blobs: {
      count: blobs.length,
      totalBytes: blobs.reduce((sum, blob) => sum + blob.byteSize, 0)
    },
    createdAt: Number(now)
  };
  return { ...base, manifestHash: sha256Canonical(base) };
}

function buildArchiveMetadata(snapshot, createdAt) {
  const metadata = {
    format: "AetherX Full Archive",
    formatVersion: FORMAT_VERSION,
    digestAlgorithm: DIGEST_ALGORITHM,
    archiveMode: "full_restore_only",
    createdAt,
    label: "双 Hub Bootstrap",
    account: snapshot.account,
    credentials: snapshot.credentials,
    records: snapshot.records,
    media: snapshot.media.map(({ filePath: _filePath, ...item }) => item),
    recordCounts: Object.fromEntries(
      TABLES.map((table) => [table, snapshot.records[table].length])
    ),
    totalMediaBytes: snapshot.media.reduce((sum, item) => sum + item.byteSize, 0)
  };
  metadata.continuityDigest = continuityDigest(metadata);
  return metadata;
}

function encryptPayload(value, key, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(canonicalStringify(aad), "utf8"));
  const ciphertext = Buffer.concat([
    cipher.update(canonicalStringify(value), "utf8"),
    cipher.final()
  ]);
  return {
    version: 1,
    algorithm: SNAPSHOT_ENCRYPTION,
    aad,
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    authenticationTag: cipher.getAuthTag().toString("base64")
  };
}

function decryptPayload(envelope, key) {
  try {
    if (envelope?.version !== 1 || envelope?.algorithm !== SNAPSHOT_ENCRYPTION) {
      throw new Error("invalid envelope");
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      key,
      Buffer.from(envelope.iv, "base64")
    );
    decipher.setAAD(Buffer.from(canonicalStringify(envelope.aad), "utf8"));
    decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
    return JSON.parse(Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8"));
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "SNAPSHOT_PAYLOAD_INVALID", "Bootstrap 数据包无法解密或已经损坏。");
  }
}

function verifyPackage({
  packageValue,
  envelope,
  context,
  sourceNodeId,
  clusterRepository,
  syncKey
}) {
  const aad = envelope.aad || {};
  if (
    packageValue?.formatVersion !== SNAPSHOT_FORMAT_VERSION ||
    packageValue.snapshotId !== aad.snapshotId ||
    aad.spaceId !== context.space_id ||
    aad.sourceNodeId !== sourceNodeId ||
    aad.requestedByNodeId !== context.local_node_id ||
    Number(aad.epoch) !== Number(context.epoch) ||
    packageValue.manifest?.manifestHash !== aad.manifestHash
  ) {
    throw new HttpError(400, "SNAPSHOT_PACKAGE_MISMATCH", "Bootstrap 数据包身份或集群边界不匹配。");
  }
  const metadata = validateMetadata(packageValue.metadata);
  const manifest = buildManifest({
    snapshot: {
      account: metadata.account,
      credentials: metadata.credentials,
      records: metadata.records,
      media: metadata.media
    },
    context,
    boundary: packageValue.manifest.boundary,
    now: packageValue.manifest.createdAt,
    sourceNodeId
  });
  if (manifest.manifestHash !== packageValue.manifest.manifestHash) {
    throw new HttpError(400, "SNAPSHOT_MANIFEST_MISMATCH", "Bootstrap 数据与 Manifest 摘要不一致。");
  }
  const replication = verifyReplicationState({
    replication: packageValue.replication,
    manifest,
    context,
    clusterRepository,
    syncKey
  });
  return {
    manifest: { ...manifest, snapshotId: packageValue.snapshotId },
    metadata,
    replication
  };
}

function verifyReplicationState({
  replication,
  manifest,
  context,
  clusterRepository,
  syncKey
}) {
  if (!Array.isArray(replication?.operations) || !Array.isArray(replication.entityVersions)) {
    throw new HttpError(400, "SNAPSHOT_REPLICATION_INVALID", "Bootstrap 复制状态无效。");
  }
  const grouped = new Map();
  const latestEntityVersions = new Map();
  const validatedOperations = [];
  for (const input of replication.operations) {
    const operation = validateOperation(input, { syncKey });
    if (
      operation.spaceId !== context.space_id ||
      operation.epoch !== Number(context.epoch) ||
      !clusterRepository.findNode(context.space_id, operation.originNodeId)
    ) {
      throw new HttpError(400, "SNAPSHOT_OPERATION_INVALID", "Bootstrap Operation 不属于当前集群。");
    }
    const list = grouped.get(operation.originNodeId) || [];
    list.push(operation);
    grouped.set(operation.originNodeId, list);
    latestEntityVersions.set(
      `${operation.entityType}\u0000${operation.entityId}`,
      operation.entityVersion
    );
    validatedOperations.push(operation);
  }
  for (const [originNodeId, head] of Object.entries(manifest.boundary.operations)) {
    const list = (grouped.get(originNodeId) || [])
      .sort((left, right) => left.originSequence - right.originSequence);
    let previousHash = "";
    for (let index = 0; index < list.length; index += 1) {
      const operation = list[index];
      if (
        operation.originSequence !== index + 1 ||
        operation.previousOperationHash !== previousHash
      ) {
        throw new HttpError(400, "SNAPSHOT_OPERATION_GAP", "Bootstrap Operation 哈希链不连续。");
      }
      previousHash = operation.operationHash;
    }
    if (list.length !== head.sequence || previousHash !== head.operationHash) {
      throw new HttpError(400, "SNAPSHOT_BOUNDARY_MISMATCH", "Bootstrap Operation 未到达声明边界。");
    }
    grouped.delete(originNodeId);
  }
  if (grouped.size) {
    throw new HttpError(400, "SNAPSHOT_BOUNDARY_MISMATCH", "Bootstrap 包含边界之外的 Operation。");
  }
  const receivedVersions = new Map();
  const normalizedVersions = [];
  for (const item of replication.entityVersions) {
    const entityType = String(item?.entityType || "").trim();
    const entityId = String(item?.entityId || "").trim();
    const key = `${entityType}\u0000${entityId}`;
    const version = Number(item?.version);
    const updatedAt = Number(item?.updatedAt);
    if (
      !entityType ||
      !entityId ||
      entityType.length > 160 ||
      entityId.length > 256 ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      !Number.isSafeInteger(updatedAt) ||
      updatedAt < 0 ||
      receivedVersions.has(key)
    ) {
      throw new HttpError(400, "SNAPSHOT_ENTITY_VERSION_INVALID", "Bootstrap 实体版本无效。");
    }
    receivedVersions.set(key, version);
    normalizedVersions.push({ entityType, entityId, version, updatedAt });
  }
  if (
    receivedVersions.size !== latestEntityVersions.size ||
    [...latestEntityVersions].some(([key, version]) => receivedVersions.get(key) !== version)
  ) {
    throw new HttpError(400, "SNAPSHOT_ENTITY_VERSION_MISMATCH", "Bootstrap 实体版本与 Operation 不一致。");
  }
  return { operations: validatedOperations, entityVersions: normalizedVersions };
}

function tableManifest(name, rows) {
  const leaves = rows.map((row) => sha256Canonical(row)).sort(compareText);
  return {
    name,
    rowCount: rows.length,
    root: merkleRoot(leaves)
  };
}

function switchRecordsRoot(snapshot) {
  const tableEntries = [
    ...TABLES.map((name) => tableManifest(
      name,
      (snapshot.records[name] || []).map(normalizeSwitchIntegrityRow)
    )),
    tableManifest("$account", [normalizeSwitchIntegrityRow(snapshot.account || {})]),
    tableManifest("$credentials", [normalizeSwitchIntegrityRow(snapshot.credentials || {})])
  ].sort((left, right) => compareText(left.name, right.name));
  return merkleRoot(tableEntries.map((table) => sha256Canonical(table)));
}

function normalizeSwitchIntegrityRow(row) {
  const result = { ...row };
  for (const [key, value] of Object.entries(result)) {
    if (!key.endsWith("_json") || typeof value !== "string") continue;
    try {
      result[key] = canonicalStringify(JSON.parse(value));
    } catch {
      // A non-JSON text value remains byte-for-byte unchanged.
    }
  }
  removeRedundantJsonAliases(result);
  normalizeBooleanInteger(result, "completed");
  normalizeBooleanInteger(result, "enabled");
  return result;
}

function normalizeBooleanInteger(row, key) {
  if (typeof row[key] === "boolean") row[key] = row[key] ? 1 : 0;
}

function removeRedundantJsonAliases(row) {
  for (const [source, target] of SWITCH_JSON_FIELD_ALIASES) {
    if (Object.hasOwn(row, target)) delete row[source];
  }
}

const SWITCH_JSON_FIELD_ALIASES = Object.freeze([
  ["goals", "goals_json"],
  ["value", "value_json"],
  ["entities", "entities_json"],
  ["traits", "traits_json"],
  ["values", "values_json"],
  ["participants", "participants_json"],
  ["settings", "settings_json"],
  ["tags", "tags_json"],
  ["symbols", "symbols_json"],
  ["raw_payload", "raw_payload_json"],
  ["based_on_event_ids", "based_on_event_ids_json"],
  ["state", "state_json"],
  ["payload", "payload_json"]
]);

function merkleRoot(leaves) {
  if (!leaves.length) return sha256Canonical([]);
  let level = leaves.map((leaf) => String(leaf));
  while (level.length > 1) {
    const next = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index];
      const right = level[index + 1] || left;
      next.push(createHash("sha256")
        .update(canonicalStringify([left, right]), "utf8")
        .digest("hex"));
    }
    level = next;
  }
  return level[0];
}

function sameBoundary(left, right) {
  return canonicalStringify(left) === canonicalStringify(right);
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function assertDatabaseHealthy(database) {
  const rows = database.prepare("PRAGMA quick_check").all();
  const healthy = rows.length === 1 && Object.values(rows[0])[0] === "ok";
  if (!healthy) {
    throw new HttpError(
      409,
      "SWITCH_DATABASE_CHECK_FAILED",
      "Hub 数据库快速一致性检查未通过。"
    );
  }
}

function assertCompletionMatches(proof, integrity) {
  if (
    proof.recordsRoot !== integrity.recordsRoot ||
    proof.blobsRoot !== integrity.blobsRoot ||
    canonicalStringify(proof.operationHeads || {}) !==
      canonicalStringify(integrity.boundary.operations)
  ) {
    throw new HttpError(
      409,
      "BOOTSTRAP_INTEGRITY_MISMATCH",
      "两台 Hub 的最终数据摘要或连续 Operation 位置不一致。",
      {
        recordsRootMatches: proof.recordsRoot === integrity.recordsRoot,
        blobsRootMatches: proof.blobsRoot === integrity.blobsRoot,
        operationHeadsMatch:
          canonicalStringify(proof.operationHeads || {}) ===
          canonicalStringify(integrity.boundary.operations)
      }
    );
  }
}

function signCompletionReceipt(receipt, key) {
  return createHmac("sha256", key)
    .update(sha256Canonical(receipt), "utf8")
    .digest("hex");
}

function verifyCompletionReceipt(receipt, authenticationTag, key) {
  const received = String(authenticationTag || "").toLowerCase();
  const expected = signCompletionReceipt(receipt, key);
  return /^[a-f0-9]{64}$/.test(received) &&
    timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
}

function parseBlobInteger(value, field, fallback) {
  const normalized = value === undefined || value === null || value === "" ? fallback : Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 0) {
    throw new HttpError(400, "SNAPSHOT_BLOB_RANGE_INVALID", `原图分块 ${field} 无效。`);
  }
  return normalized;
}

function decodeBlobChunk(value) {
  if (typeof value !== "string" || !value.length || value.length % 4 !== 0) {
    throw new HttpError(400, "SNAPSHOT_BLOB_CHUNK_INVALID", "原图分块不是有效的 Base64 数据。");
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new HttpError(400, "SNAPSHOT_BLOB_CHUNK_INVALID", "原图分块不是有效的 Base64 数据。");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value) {
    throw new HttpError(400, "SNAPSHOT_BLOB_CHUNK_INVALID", "原图分块 Base64 编码不规范。");
  }
  return bytes;
}

function ensureBlobStageDirectory(tempDir, snapshotId) {
  const directoryName = createHash("sha256")
    .update(String(snapshotId || ""), "utf8")
    .digest("hex");
  const root = path.join(tempDir, "bootstrap-blobs");
  const directory = safeSingleLevelPath(root, directoryName);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function safeSingleLevelPath(directory, fileName) {
  const root = path.resolve(directory);
  const result = path.resolve(root, String(fileName || ""));
  if (!fileName || path.dirname(result) !== root) {
    throw new HttpError(400, "SNAPSHOT_BLOB_PATH_INVALID", "Bootstrap 原图路径无效。");
  }
  return result;
}

function reconcileBlobFile(filePath, recordedBytes) {
  if (!fs.existsSync(filePath)) return 0;
  const actualBytes = fs.statSync(filePath).size;
  if (actualBytes > recordedBytes) {
    fs.truncateSync(filePath, recordedBytes);
    return recordedBytes;
  }
  return actualBytes;
}

function fileRangeEquals(filePath, offset, expected) {
  if (!fs.existsSync(filePath)) return false;
  const actual = Buffer.alloc(expected.length);
  const descriptor = fs.openSync(filePath, "r");
  try {
    const bytesRead = fs.readSync(descriptor, actual, 0, actual.length, offset);
    return bytesRead === expected.length && timingSafeEqual(actual, expected);
  } finally {
    fs.closeSync(descriptor);
  }
}

function appendBlobChunk(filePath, bytes, offset) {
  const descriptor = fs.openSync(filePath, fs.existsSync(filePath) ? "r+" : "wx+", 0o600);
  try {
    const written = fs.writeSync(descriptor, bytes, 0, bytes.length, offset);
    if (written !== bytes.length) {
      throw new HttpError(500, "SNAPSHOT_BLOB_WRITE_INCOMPLETE", "原图分块未完整写入。");
    }
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
}

async function hashFile(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function presentBlobProgress(blob, duplicate) {
  return {
    snapshotId: blob.snapshotId,
    mediaId: blob.mediaId,
    contentHash: blob.contentHash,
    byteSize: blob.byteSize,
    receivedBytes: blob.receivedBytes,
    status: blob.status,
    complete: blob.status === "verified",
    duplicate
  };
}

module.exports = {
  buildArchiveMetadata,
  buildManifest,
  decryptPayload,
  encryptPayload,
  IntegrityService,
  MAX_STRUCTURED_PAYLOAD_BYTES,
  MAX_BLOB_CHUNK_BYTES,
  merkleRoot,
  normalizeSwitchIntegrityRow,
  signCompletionReceipt,
  SNAPSHOT_FORMAT_VERSION,
  switchRecordsRoot
};
