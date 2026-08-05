const { createHash } = require("node:crypto");
const { HttpError } = require("../../lib/http-error");

const BLOB_CHUNK_BYTES = 1024 * 1024;
const MAX_FINAL_RECONCILIATION_ATTEMPTS = 3;

class BootstrapCoordinator {
  constructor({
    clusterService,
    clusterRepository,
    replicationRepository,
    replicationApplyService,
    integrityService,
    peerTransport
  }) {
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.replicationRepository = replicationRepository;
    this.replicationApplyService = replicationApplyService;
    this.integrityService = integrityService;
    this.peerTransport = peerTransport;
    this.runningUsers = new Set();
  }

  async run(userId) {
    if (this.runningUsers.has(userId)) {
      throw new HttpError(409, "BOOTSTRAP_ALREADY_RUNNING", "当前账号的双 Hub 初始化正在进行。");
    }
    this.runningUsers.add(userId);
    try {
      return await this.runUnlocked(userId);
    } finally {
      this.runningUsers.delete(userId);
    }
  }

  async runUnlocked(userId) {
    const context = this.clusterService.ensureSpace(userId);
    if (context.local_node_id === context.active_node_id) {
      throw new HttpError(409, "BOOTSTRAP_TARGET_IS_ACTIVE", "活动 Hub 不能作为 Bootstrap 目标。");
    }
    const localNode = this.clusterRepository.findNode(context.space_id, context.local_node_id);
    if (!localNode || !["pairing", "standby_pending"].includes(localNode.status)) {
      throw new HttpError(409, "BOOTSTRAP_TARGET_STATE_INVALID", "本机 Hub 当前不需要执行 Bootstrap。");
    }
    const sourceNodeId = context.active_node_id;
    const hello = await this.peerTransport.requestJson(userId, sourceNodeId, {
      method: "POST",
      path: "/api/v1/peer/hello",
      body: {
        protocolVersion: Number(context.protocol_version),
        schemaVersion: Number(context.schema_version),
        spaceId: context.space_id,
        nodeId: context.local_node_id,
        epoch: Number(context.epoch),
        activeNodeId: sourceNodeId
      }
    });
    if (hello.data.nodeId !== sourceNodeId) {
      throw new HttpError(409, "BOOTSTRAP_SOURCE_IDENTITY_MISMATCH", "连接到的活动 Hub 身份不匹配。");
    }

    const snapshotResponse = await this.peerTransport.requestJson(userId, sourceNodeId, {
      method: "POST",
      path: "/api/v1/peer/snapshots",
      body: {}
    });
    const snapshotId = String(snapshotResponse.data?.id || "");
    if (!snapshotId) {
      throw new HttpError(502, "BOOTSTRAP_SNAPSHOT_INVALID", "活动 Hub 没有返回有效快照。");
    }
    const payloadResponse = await this.peerTransport.requestJson(userId, sourceNodeId, {
      method: "GET",
      path: `/api/v1/peer/snapshots/${encodeURIComponent(snapshotId)}/payload`
    });
    this.integrityService.stageSnapshotPayload(userId, sourceNodeId, {
      envelope: payloadResponse.data?.envelope
    });
    await this.transferSnapshotBlobs(userId, sourceNodeId, snapshotId);
    const restored = await this.integrityService.restoreStaging(userId, snapshotId);

    let completion;
    for (let attempt = 1; attempt <= MAX_FINAL_RECONCILIATION_ATTEMPTS; attempt += 1) {
      await this.pullUntilCurrent(userId, sourceNodeId);
      const proof = await this.integrityService.createCompletionProof(userId, snapshotId);
      try {
        completion = await this.peerTransport.requestJson(userId, sourceNodeId, {
          method: "POST",
          path: "/api/v1/peer/bootstrap/complete",
          body: { proof }
        });
        break;
      } catch (error) {
        if (error.code !== "BOOTSTRAP_INTEGRITY_MISMATCH" ||
            attempt === MAX_FINAL_RECONCILIATION_ATTEMPTS) {
          throw error;
        }
      }
    }
    const receipt = completion.data;
    const localFinalized = await this.integrityService.finalizeLocalStandby(
      userId,
      snapshotId,
      receipt
    );
    const sourceFinalized = await this.peerTransport.requestJson(userId, sourceNodeId, {
      method: "POST",
      path: "/api/v1/peer/bootstrap/finalize",
      body: receipt
    });
    return {
      snapshotId,
      sourceNodeId,
      restored,
      localNodeStatus: localFinalized.localNodeStatus,
      sourceSnapshotStatus: sourceFinalized.data.snapshotStatus,
      ready: localFinalized.localNodeStatus === "standby" &&
        sourceFinalized.data.snapshotStatus === "completed"
    };
  }

  async transferSnapshotBlobs(userId, sourceNodeId, snapshotId) {
    let status = this.integrityService.getStagingStatus(userId, snapshotId);
    for (const blob of status.blobs.items) {
      let offset = blob.receivedBytes;
      while (offset < blob.byteSize) {
        const requestPath =
          `/api/v1/peer/snapshots/${encodeURIComponent(snapshotId)}` +
          `/blobs/${encodeURIComponent(blob.mediaId)}` +
          `?offset=${offset}&length=${BLOB_CHUNK_BYTES}`;
        const response = await this.peerTransport.requestBinary(userId, sourceNodeId, {
          method: "GET",
          path: requestPath
        });
        const bytes = response.data;
        const headers = response.headers;
        const chunkHash = createHash("sha256").update(bytes).digest("hex");
        if (
          !bytes.length ||
          headers["x-aetherx-blob-hash"] !== blob.contentHash ||
          headers["x-aetherx-chunk-hash"] !== chunkHash ||
          Number(headers["x-aetherx-blob-offset"]) !== offset ||
          Number(headers["x-aetherx-blob-size"]) !== blob.byteSize
        ) {
          throw new HttpError(502, "BOOTSTRAP_BLOB_RESPONSE_INVALID", "活动 Hub 返回的原图分块校验信息无效。");
        }
        const progress = await this.integrityService.receiveSnapshotBlobChunk(
          userId,
          sourceNodeId,
          snapshotId,
          blob.mediaId,
          { offset, data: bytes.toString("base64"), chunkHash }
        );
        offset = progress.receivedBytes;
      }
    }
    status = this.integrityService.getStagingStatus(userId, snapshotId);
    if (status.status !== "verified") {
      throw new HttpError(409, "BOOTSTRAP_BLOBS_INCOMPLETE", "Bootstrap 原图仍未完整接收。");
    }
  }

  async pullUntilCurrent(userId, sourceNodeId, options = {}) {
    const context = this.clusterService.ensureSpace(userId);
    let acknowledgement = null;
    let remoteSequence = 0;
    for (;;) {
      const latest = this.replicationRepository.latestOperation(context.space_id, sourceNodeId);
      const after = latest?.originSequence || 0;
      const requestPath =
        `/api/v1/peer/operations?origin=${encodeURIComponent(sourceNodeId)}` +
        `&after=${after}&limit=200`;
      const pulled = await this.peerTransport.requestJson(userId, sourceNodeId, {
        method: "GET",
        path: requestPath,
        signal: options.signal
      });
      remoteSequence = pulled.data.headSequence;
      if (pulled.data.operations.length) {
        const applied = this.replicationApplyService.apply(
          userId,
          sourceNodeId,
          pulled.data.operations
        );
        acknowledgement = applied.acknowledgements[sourceNodeId] || acknowledgement;
      }
      const current = this.replicationRepository.latestOperation(context.space_id, sourceNodeId);
      if (current) {
        acknowledgement = {
          originNodeId: sourceNodeId,
          contiguousSequence: current.originSequence,
          operationHash: current.operationHash
        };
      }
      if (!pulled.data.hasMore && pulled.data.nextAfter >= pulled.data.headSequence) break;
    }
    if (acknowledgement) {
      await this.peerTransport.requestJson(userId, sourceNodeId, {
        method: "POST",
        path: "/api/v1/peer/acknowledgements",
        body: { acknowledgements: [acknowledgement] },
        signal: options.signal
      });
    }
    const latest = this.replicationRepository.latestOperation(context.space_id, sourceNodeId);
    return {
      localSequence: latest?.originSequence || 0,
      remoteSequence,
      acknowledgement
    };
  }
}

module.exports = { BootstrapCoordinator };
