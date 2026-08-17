const { HttpError } = require("../../lib/http-error");

const DEFAULT_TIMEOUT_MS = 5000;
const PEER_PATH_PREFIX = "/api/v1/peer/";

class PeerTransport {
  constructor({
    endpointRepository,
    clusterService,
    clusterRepository,
    peerAuthenticationService,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    now = () => Date.now()
  }) {
    this.endpointRepository = endpointRepository;
    this.clusterService = clusterService;
    this.clusterRepository = clusterRepository;
    this.peerAuthenticationService = peerAuthenticationService;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.now = now;
  }

  async requestJson(userId, peerNodeId, input) {
    return this.request(userId, peerNodeId, { ...input, responseType: "json" });
  }

  async requestBinary(userId, peerNodeId, input) {
    return this.request(userId, peerNodeId, { ...input, responseType: "binary" });
  }

  async request(userId, peerNodeId, input = {}) {
    const context = this.clusterService.ensureSpace(userId);
    const peer = this.clusterRepository.findNode(context.space_id, String(peerNodeId || ""));
    if (!peer || peer.revoked_at !== null || peer.id === context.local_node_id) {
      throw new HttpError(404, "PEER_NODE_INVALID", "对端 Hub 节点不存在。");
    }
    const method = String(input.method || "GET").toUpperCase();
    const requestPath = normalizePeerPath(input.path);
    const body = input.body ?? {};
    const endpoints = this.endpointRepository.listForNode(context.space_id, peer.id);
    if (!endpoints.length) {
      throw new HttpError(409, "PEER_ENDPOINT_UNAVAILABLE", "对端 Hub 尚未登记连接地址。");
    }
    const attempts = [];
    const remoteErrors = [];
    for (const endpoint of endpoints) {
      try {
        const result = await this.fetchEndpoint(endpoint, {
          userId,
          peerNodeId: peer.id,
          method,
          path: requestPath,
          body,
          responseType: input.responseType || "json",
          timeoutMs: input.timeoutMs,
          signal: input.signal
        });
        if (typeof input.validateResponse === "function") {
          await input.validateResponse(result.data, presentEndpoint(endpoint));
        }
        this.endpointRepository.markSuccess(endpoint.id, this.now());
        this.clusterRepository.touchNode(context.space_id, peer.id, this.now());
        return { ...result, endpoint: presentEndpoint(endpoint) };
      } catch (error) {
        if (error instanceof RemotePeerError) {
          this.endpointRepository.markSuccess(endpoint.id, this.now());
          this.clusterRepository.touchNode(context.space_id, peer.id, this.now());
          const attempt = {
            transport: endpoint.transport,
            address: endpoint.address,
            status: error.status,
            code: error.code || "PEER_REQUEST_FAILED",
            remote: true,
            ...(error.details === undefined ? {} : { details: error.details })
          };
          attempts.push(attempt);
          if (error.status < 500) throw error.toHttpError({ attempts });
          remoteErrors.push(error);
          continue;
        }
        this.endpointRepository.markFailure(endpoint.id, this.now());
        attempts.push({
          transport: endpoint.transport,
          address: endpoint.address,
          code: error.code || "PEER_ENDPOINT_FAILED"
        });
      }
    }
    if (remoteErrors.length) {
      throw remoteErrors.at(-1).toHttpError({ attempts });
    }
    throw new HttpError(
      503,
      "PEER_UNREACHABLE",
      "所有已登记的对端 Hub 地址都无法连接。",
      { attempts }
    );
  }

  async fetchEndpoint(endpoint, input) {
    const headers = this.peerAuthenticationService.createSignedHeaders(
      input.userId,
      input.peerNodeId,
      input
    );
    const hasBody = !["GET", "HEAD"].includes(input.method);
    const timeoutMs = Math.min(
      300_000,
      Math.max(1, Number(input.timeoutMs) || this.timeoutMs)
    );
    const response = await this.fetchImpl(new URL(input.path, endpoint.address), {
      method: input.method,
      headers: {
        ...headers,
        ...(hasBody ? { "Content-Type": "application/json" } : {})
      },
      ...(hasBody ? { body: JSON.stringify(input.body) } : {}),
      redirect: "error",
      signal: input.signal
        ? AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)])
        : AbortSignal.timeout(timeoutMs)
    });
    if (input.responseType === "binary" && response.ok) {
      return {
        status: response.status,
        data: Buffer.from(await response.arrayBuffer()),
        headers: Object.fromEntries(response.headers.entries())
      };
    }
    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new RemotePeerError(502, "PEER_RESPONSE_INVALID", "对端 Hub 返回了无法解析的响应。");
    }
    if (!response.ok) {
      throw new RemotePeerError(
        response.status,
        payload?.error?.code || "PEER_REQUEST_FAILED",
        payload?.error?.message || "对端 Hub 拒绝了请求。",
        payload?.error?.details
      );
    }
    return { status: response.status, data: payload?.data ?? null, headers: {} };
  }
}

class RemotePeerError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }

  toHttpError(extraDetails) {
    const details = this.details === undefined
      ? extraDetails
      : { remote: this.details, ...extraDetails };
    return new HttpError(this.status, this.code, this.message, details);
  }
}

function normalizePeerPath(value) {
  const result = String(value || "");
  if (!result.startsWith(PEER_PATH_PREFIX) || result.startsWith("//")) {
    throw new HttpError(400, "PEER_PATH_INVALID", "Peer 请求路径无效。");
  }
  const parsed = new URL(result, "http://aetherx.local");
  if (parsed.origin !== "http://aetherx.local" || parsed.hash) {
    throw new HttpError(400, "PEER_PATH_INVALID", "Peer 请求路径无效。");
  }
  return `${parsed.pathname}${parsed.search}`;
}

function presentEndpoint(endpoint) {
  return {
    transport: endpoint.transport,
    address: endpoint.address,
    priority: endpoint.priority
  };
}

module.exports = { DEFAULT_TIMEOUT_MS, PeerTransport };
