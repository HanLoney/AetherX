const { HttpError } = require("../../lib/http-error");

function registerPeerRoutes(
  router,
  {
    peerReplicationService,
    replicationApplyService,
    integrityService,
    mediaReplicationService,
    clusterService,
    switchStateMachineService,
    clientSessionHandoffService,
    divergenceRecoveryService,
    replicationScheduler
  }
) {
  router.add(
    "GET",
    "/api/v1/peer/status",
    ({ userId }) => ({ data: clusterService.status(userId) }),
    { peer: true, parseBody: false, allowDuringClusterTransition: true }
  );

  if (replicationScheduler) {
    router.add(
      "POST",
      "/api/v1/peer/synchronize",
      async ({ userId }) => ({
        data: await replicationScheduler.runNow(userId)
      }),
      { peer: true }
    );
  }

  if (divergenceRecoveryService) {
    router.add(
      "GET",
      "/api/v1/peer/divergence-recoveries/:id",
      ({ userId, auth, params }) => ({
        data: divergenceRecoveryService.peerStatus(userId, auth.peerNodeId, params.id)
      }),
      { peer: true, parseBody: false, allowDuringClusterTransition: true }
    );
    router.add(
      "POST",
      "/api/v1/peer/divergence-recoveries/:id/snapshot/chunks",
      ({ userId, auth, params, body }) => ({
        data: divergenceRecoveryService.receiveSnapshotChunk(
          userId,
          auth.peerNodeId,
          params.id,
          body
        )
      }),
      { peer: true, allowDuringClusterTransition: true }
    );
    router.add(
      "POST",
      "/api/v1/peer/divergence-recoveries/:id/snapshot/complete",
      async ({ userId, auth, params, body }) => ({
        data: await divergenceRecoveryService.completeSnapshotUpload(
          userId,
          auth.peerNodeId,
          params.id,
          body
        )
      }),
      { peer: true, allowDuringClusterTransition: true }
    );
    router.add(
      "GET",
      "/api/v1/peer/divergence-recoveries/:id/snapshot/chunks",
      ({ userId, auth, params, query }) => ({
        data: divergenceRecoveryService.getSnapshotChunk(
          userId,
          auth.peerNodeId,
          params.id,
          query
        )
      }),
      { peer: true, parseBody: false, allowDuringClusterTransition: true }
    );
    router.add(
      "GET",
      "/api/v1/peer/divergence-recoveries/:id/media/:mediaId",
      ({ userId, auth, params, query, response }) => {
        const chunk = divergenceRecoveryService.getMediaChunk(
          userId,
          auth.peerNodeId,
          params.id,
          params.mediaId,
          query
        );
        response.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Length": chunk.bytes.length,
          "Cache-Control": "no-store",
          "Accept-Ranges": "bytes",
          "X-AetherX-Blob-Hash": chunk.contentHash,
          "X-AetherX-Chunk-Hash": chunk.chunkHash,
          "X-AetherX-Blob-Offset": String(chunk.offset),
          "X-AetherX-Blob-Size": String(chunk.byteSize)
        });
        response.end(chunk.bytes);
        return { handled: true };
      },
      { peer: true, parseBody: false, allowDuringClusterTransition: true }
    );
    router.add(
      "POST",
      "/api/v1/peer/divergence-recoveries/:id/ack",
      ({ userId, auth, params, body }) => ({
        data: divergenceRecoveryService.acknowledge(
          userId,
          auth.peerNodeId,
          params.id,
          body
        )
      }),
      { peer: true, allowDuringClusterTransition: true }
    );
  }

  router.add(
    "GET",
    "/api/v1/peer/media/manifest",
    ({ userId, auth, query }) => ({
      data: mediaReplicationService.getManifest(userId, auth.peerNodeId, query)
    }),
    { peer: true, parseBody: false, allowDuringWriteLock: true }
  );

  router.add(
    "GET",
    "/api/v1/peer/media/:id/blob",
    ({ userId, auth, params, query, response }) => {
      const chunk = mediaReplicationService.getBlobChunk(
        userId,
        auth.peerNodeId,
        params.id,
        query
      );
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": chunk.bytes.length,
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
        "X-AetherX-Blob-Hash": chunk.contentHash,
        "X-AetherX-Chunk-Hash": chunk.chunkHash,
        "X-AetherX-Blob-Offset": String(chunk.offset),
        "X-AetherX-Blob-Size": String(chunk.byteSize)
      });
      response.end(chunk.bytes);
      return { handled: true };
    },
    { peer: true, parseBody: false, allowDuringWriteLock: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/media/chunks",
    ({ userId, auth, body }) => ({
      data: mediaReplicationService.receiveChunk(userId, auth.peerNodeId, body)
    }),
    {
      peer: true,
      allowDuringWriteLock: true,
      allowDuringClusterTransition: true
    }
  );

  router.add(
    "POST",
    "/api/v1/peer/media/status",
    ({ userId, auth, body }) => ({
      data: mediaReplicationService.receiveStatus(userId, auth.peerNodeId, body)
    }),
    {
      peer: true,
      allowDuringWriteLock: true,
      allowDuringClusterTransition: true
    }
  );

  router.add(
    "POST",
    "/api/v1/peer/client-sessions/mint",
    ({ userId, auth }) => ({
      data: clientSessionHandoffService.mintForPeer(userId, auth.peerNodeId)
    }),
    { peer: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/switch/preflight",
    async ({ userId, auth }) => ({
      data: await integrityService.createSwitchPreflightProof(
        userId,
        auth.peerNodeId
      )
    }),
    { peer: true, allowDuringClusterTransition: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/switch/control",
    ({ userId, auth, body }) => ({
      data: switchStateMachineService.applyPeerControl(
        userId,
        auth.peerNodeId,
        body
      )
    }),
    { peer: true, allowDuringClusterTransition: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/switch/final-sync",
    async ({ userId, auth, body }) => ({
      data: await switchStateMachineService.runPeerFinalSync(
        userId,
        auth.peerNodeId,
        body
      )
    }),
    { peer: true, allowDuringClusterTransition: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/mobile-switch/start",
    async ({ userId, auth, body }) => ({
      data: await switchStateMachineService.startMobileSwitch(
        userId,
        auth.peerNodeId,
        body
      )
    }),
    { peer: true, allowDuringClusterTransition: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/mobile-switch/advance",
    async ({ userId, auth, body }) => ({
      data: await switchStateMachineService.advanceMobileSwitch(
        userId,
        auth.peerNodeId,
        body
      )
    }),
    { peer: true, allowDuringClusterTransition: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/mobile-switch/request",
    async ({ userId, auth }) => {
      const prepared = await switchStateMachineService.prepare(userId, {
        targetNodeId: auth.peerNodeId
      });
      const committed = await switchStateMachineService.commit(userId, {
        transitionId: prepared.transitionId
      });
      return {
        data: {
          completed: committed.committed === true,
          activeNodeId: committed.activeNodeId,
          epoch: committed.epoch,
          state: committed.cluster?.state || "stable"
        }
      };
    },
    { peer: true, allowDuringClusterTransition: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/snapshots",
    async ({ userId, auth }) => ({
      status: 201,
      data: await integrityService.createSnapshotManifest(userId, auth.peerNodeId)
    }),
    { peer: true }
  );

  router.add(
    "GET",
    "/api/v1/peer/snapshots/:id/payload/chunks",
    ({ userId, auth, params, query }) => ({
      data: integrityService.getSnapshotPayloadChunk(
        userId,
        auth.peerNodeId,
        params.id,
        query
      )
    }),
    { peer: true, parseBody: false }
  );

  router.add(
    "GET",
    "/api/v1/peer/snapshots/:id/payload",
    ({ userId, auth, params }) => ({
      data: integrityService.getSnapshotPayload(userId, auth.peerNodeId, params.id)
    }),
    { peer: true, parseBody: false }
  );

  router.add(
    "GET",
    "/api/v1/peer/snapshots/:id/blobs/:mediaId",
    ({ userId, auth, params, query, response }) => {
      const chunk = integrityService.getSnapshotBlobChunk(
        userId,
        auth.peerNodeId,
        params.id,
        params.mediaId,
        query
      );
      response.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Length": chunk.bytes.length,
        "Cache-Control": "no-store",
        "Accept-Ranges": "bytes",
        "X-AetherX-Blob-Hash": chunk.contentHash,
        "X-AetherX-Chunk-Hash": chunk.chunkHash,
        "X-AetherX-Blob-Offset": String(chunk.offset),
        "X-AetherX-Blob-Size": String(chunk.byteSize)
      });
      response.end(chunk.bytes);
      return { handled: true };
    },
    { peer: true, parseBody: false, allowDuringWriteLock: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/snapshots/:id/blobs/:mediaId/chunks",
    async ({ userId, auth, params, body }) => ({
      data: await integrityService.receiveSnapshotBlobChunk(
        userId,
        auth.peerNodeId,
        params.id,
        params.mediaId,
        body
      )
    }),
    { peer: true, allowDuringWriteLock: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/snapshots/stage",
    ({ userId, auth, body }) => ({
      data: integrityService.stageSnapshotPayload(userId, auth.peerNodeId, body)
    }),
    { peer: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/bootstrap/complete",
    async ({ userId, auth, body }) => ({
      data: await integrityService.verifyCompletionProof(
        userId,
        auth.peerNodeId,
        body?.proof
      )
    }),
    { peer: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/bootstrap/finalize",
    ({ userId, auth, body }) => ({
      data: integrityService.acknowledgeStandby(userId, auth.peerNodeId, body)
    }),
    { peer: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/hello",
    ({ userId, auth, body }) => {
      assertAuthenticatedNode(auth, body?.nodeId);
      return { data: peerReplicationService.hello(userId, body) };
    },
    { peer: true, allowDuringClusterTransition: true }
  );

  router.add(
    "GET",
    "/api/v1/peer/operations",
    ({ userId, query }) => {
      const context = clusterService.ensureSpace(userId);
      const originNodeId = String(query.origin || "").trim();
      if (originNodeId !== context.local_node_id) {
        throw new HttpError(
          400,
          "PEER_ORIGIN_NOT_LOCAL",
          "当前接口只提供本 Hub 产生的 Operation。"
        );
      }
      return {
        data: peerReplicationService.pull(userId, {
          originNodeId,
          after: query.after,
          limit: query.limit
        })
      };
    },
    { peer: true, parseBody: false }
  );

  router.add(
    "POST",
    "/api/v1/peer/operations/apply",
    ({ userId, auth, body }) => ({
      data: replicationApplyService.apply(userId, auth.peerNodeId, body?.operations)
    }),
    { peer: true, allowDuringClusterTransition: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/acknowledgements",
    ({ userId, auth, body }) => ({
      data: peerReplicationService.acknowledge(
        userId,
        auth.peerNodeId,
        body?.acknowledgements
      )
    }),
    { peer: true, allowDuringClusterTransition: true }
  );

  router.add(
    "POST",
    "/api/v1/peer/sync-complete",
    ({ userId, auth, body }) => ({
      data: peerReplicationService.confirmSync(
        userId,
        auth.peerNodeId,
        body
      )
    }),
    { peer: true, allowDuringClusterTransition: true }
  );
}

function assertAuthenticatedNode(auth, claimedNodeId) {
  if (String(claimedNodeId || "").trim() !== auth.peerNodeId) {
    throw new HttpError(
      403,
      "PEER_IDENTITY_MISMATCH",
      "Hello 中声明的 Hub 与签名身份不一致。"
    );
  }
}

module.exports = { registerPeerRoutes };
