const { HttpError } = require("../../lib/http-error");

const DEFAULT_PROBE_TIMEOUT_MS = 5000;

class MobileHubProbeService {
  constructor({
    clusterService,
    peerTransport,
    timeoutMs = DEFAULT_PROBE_TIMEOUT_MS,
    now = () => Date.now()
  }) {
    this.clusterService = clusterService;
    this.peerTransport = peerTransport;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async list(userId) {
    const cluster = this.clusterService.status(userId);
    const hubs = this.clusterService.mobileHubs(userId);
    return Promise.all(hubs.map((hub) => this.probe(userId, cluster, hub)));
  }

  async probe(userId, cluster, hub) {
    const checkedAt = this.now();
    try {
      const response = await this.peerTransport.requestJson(userId, hub.id, {
        method: "GET",
        path: "/api/v1/peer/status",
        timeoutMs: this.timeoutMs,
        validateResponse: (remote) => validatePeerStatus(remote, cluster.spaceId, hub.id)
      });
      let remoteSequence = null;
      let sequenceError = null;
      if (hub.replication) {
        try {
          const sequenceResponse = await this.peerTransport.requestJson(userId, hub.id, {
            method: "GET",
            path: `/api/v1/peer/operations?origin=${encodeURIComponent(hub.id)}` +
              `&after=${Math.max(0, Number(hub.replication.localSequence) || 0)}&limit=1`,
            timeoutMs: this.timeoutMs
          });
          remoteSequence = nullableNumber(sequenceResponse.data?.headSequence);
        } catch (error) {
          sequenceError = error;
        }
      }
      return presentProbeResult(hub, {
        online: true,
        checkedAt,
        endpoint: response.endpoint,
        remote: response.data,
        remoteSequence,
        sequenceError
      });
    } catch (error) {
      return presentProbeResult(hub, {
        online: false,
        checkedAt,
        error
      });
    }
  }
}

function validatePeerStatus(remote, expectedSpaceId, expectedNodeId) {
  const spaceId = String(remote?.spaceId || "");
  const nodeId = String(remote?.localNodeId || remote?.nodeId || "");
  if (spaceId !== String(expectedSpaceId) || nodeId !== String(expectedNodeId)) {
    throw new HttpError(
      502,
      "PEER_IDENTITY_MISMATCH",
      "Connected Hub identity does not match the registered peer.",
      { expectedSpaceId, expectedNodeId, spaceId, nodeId }
    );
  }
}

function presentProbeResult(hub, probe) {
  const replication = hub.replication ? { ...hub.replication } : null;
  const remoteOperationCount = nullableNumber(probe.remoteSequence);
  if (replication) {
    replication.confirmedCurrent = probe.online &&
      replication.caughtUp === true &&
      remoteOperationCount !== null &&
      remoteOperationCount === Number(replication.localSequence) &&
      remoteOperationCount === Number(replication.remoteSequence);
  }
  if (probe.online) {
    return {
      ...hub,
      hubOnline: true,
      hubLastSeenAt: probe.checkedAt,
      hubAgeMs: 0,
      replication,
      reachability: {
        state: "online",
        checkedAt: probe.checkedAt,
        transport: probe.endpoint?.transport || "",
        address: probe.endpoint?.address || "",
        remoteEpoch: nullableNumber(probe.remote?.epoch),
        remoteActiveNodeId: String(probe.remote?.activeNodeId || ""),
        remoteOperationCount,
        sequenceCode: String(probe.sequenceError?.code || "")
      }
    };
  }
  return {
    ...hub,
    hubOnline: false,
    replication,
    reachability: {
      state: "offline",
      checkedAt: probe.checkedAt,
      code: String(probe.error?.code || "PEER_UNREACHABLE"),
      attempts: Array.isArray(probe.error?.details?.attempts)
        ? probe.error.details.attempts
        : []
    }
  };
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

module.exports = {
  DEFAULT_PROBE_TIMEOUT_MS,
  MobileHubProbeService,
  validatePeerStatus
};
