const dgram = require("node:dgram");
const { execFile } = require("node:child_process");

const DISCOVERY_PORT = 4317;
const DISCOVERY_TYPE = "aetherx-hub-discovery";
const CANDIDATE_TTL_MS = 20_000;
const DEFAULT_MOBILE_HUB_PORT = 4319;
const MOBILE_HUB_PORTS = Array.from({ length: 11 }, (_value, index) => 4319 + index);

class MobileHubLanDiscovery {
  constructor({
    socketFactory = () => dgram.createSocket({ type: "udp4", reuseAddr: true }),
    now = () => Date.now(),
    neighborProvider = systemNeighborHosts,
    fetchImpl = (...args) => fetch(...args)
  } = {}) {
    this.socketFactory = socketFactory;
    this.now = now;
    this.neighborProvider = neighborProvider;
    this.fetchImpl = fetchImpl;
    this.socket = null;
    this.discovered = new Map();
    this.waiters = new Set();
  }

  start() {
    if (this.socket) return;
    const socket = this.socketFactory();
    this.socket = socket;
    socket.on("error", () => {});
    socket.on("message", (payload, remote) => {
      const endpoint = parseMobileHubBeacon(payload, remote);
      if (!endpoint) return;
      this.discovered.set(endpoint.address, { endpoint, seenAt: this.now() });
      for (const resolve of this.waiters) resolve(this.candidates());
      this.waiters.clear();
    });
    socket.bind(DISCOVERY_PORT, "0.0.0.0");
  }

  candidates(maxAgeMs = CANDIDATE_TTL_MS) {
    const cutoff = this.now() - maxAgeMs;
    const result = [];
    for (const [address, candidate] of this.discovered) {
      if (candidate.seenAt < cutoff) {
        this.discovered.delete(address);
        continue;
      }
      result.push(candidate.endpoint);
    }
    return result;
  }

  waitForCandidates(timeoutMs = 2_500) {
    const current = this.candidates();
    if (current.length) return Promise.resolve(current);
    return new Promise((resolve) => {
      const finish = (items = []) => {
        clearTimeout(timer);
        this.waiters.delete(finish);
        resolve(items);
      };
      const timer = setTimeout(() => finish(this.candidates()), timeoutMs);
      timer.unref?.();
      this.waiters.add(finish);
    });
  }

  async discoverCandidates(broadcastWaitMs = 1_200) {
    const broadcastCandidates = await this.waitForCandidates(broadcastWaitMs);
    if (broadcastCandidates.length) return broadcastCandidates;
    const hosts = await this.neighborProvider().catch(() => []);
    const primary = await this.probeHosts(hosts, [DEFAULT_MOBILE_HUB_PORT]);
    if (primary.length) return primary;
    return this.probeHosts(hosts, MOBILE_HUB_PORTS.slice(1));
  }

  async probeHosts(hosts, ports) {
    const uniqueHosts = [...new Set(hosts.filter(isPrivateIpv4))].slice(0, 128);
    const found = [];
    for (let offset = 0; offset < uniqueHosts.length; offset += 16) {
      const batch = uniqueHosts.slice(offset, offset + 16);
      const results = await Promise.all(batch.map((host) => this.probeHost(host, ports)));
      for (const endpoint of results.filter(Boolean)) {
        this.discovered.set(endpoint.address, { endpoint, seenAt: this.now() });
        found.push(endpoint);
      }
      if (found.length) break;
    }
    return found;
  }

  async probeHost(host, ports) {
    for (const port of ports) {
      const endpoint = await probeMobileHubHealth(this.fetchImpl, host, port);
      if (endpoint) return endpoint;
    }
    return null;
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.close();
    for (const resolve of this.waiters) resolve([]);
    this.waiters.clear();
    this.discovered.clear();
  }
}

function systemNeighborHosts() {
  return new Promise((resolve) => {
    execFile("arp", ["-a"], { windowsHide: true, timeout: 2_000 }, (error, stdout) => {
      resolve(error ? [] : parseArpIpv4Hosts(stdout));
    });
  });
}

function parseArpIpv4Hosts(output) {
  return [...new Set(
    String(output || "")
      .match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g)
      ?.filter((address) => isPrivateIpv4(address) && !address.endsWith(".255")) || []
  )];
}

async function probeMobileHubHealth(fetchImpl, host, port, timeoutMs = 450) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`http://${host}:${port}/health`, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    if (payload?.data?.service !== "aetherx-android-local-hub") return null;
    return {
      transport: "lan",
      address: `http://${host}:${port}`,
      priority: 850,
      certificateFingerprint: ""
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function verifyMobileHubEndpoint(fetchImpl, address, options = {}) {
  let endpoint;
  try {
    endpoint = new URL(String(address || ""));
  } catch {
    return null;
  }
  const port = Number(endpoint.port || 80);
  if (endpoint.protocol !== "http:" || !isPrivateIpv4(endpoint.hostname)) return null;
  const now = options.now || (() => Date.now());
  const startedAt = now();
  const verified = await probeMobileHubHealth(
    fetchImpl,
    endpoint.hostname,
    port,
    Math.max(1, Number(options.timeoutMs) || 900)
  );
  return verified ? {
    ...verified,
    latencyMs: Math.max(0, now() - startedAt)
  } : null;
}

function parseMobileHubBeacon(payload, remote = {}) {
  let beacon;
  try { beacon = JSON.parse(Buffer.from(payload).toString("utf8")); } catch { return null; }
  const host = String(remote.address || "");
  const port = Number(beacon?.port);
  if (
    beacon?.type !== DISCOVERY_TYPE ||
    Number(beacon?.version) !== 1 ||
    beacon?.platform !== "android" ||
    !isPrivateIpv4(host) ||
    !Number.isInteger(port) ||
    port < 4319 ||
    port > 4329
  ) return null;
  return {
    transport: "lan",
    address: `http://${host}:${port}`,
    priority: 900,
    certificateFingerprint: ""
  };
}

function isPrivateIpv4(value) {
  const parts = String(value || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

module.exports = {
  CANDIDATE_TTL_MS,
  DISCOVERY_PORT,
  DISCOVERY_TYPE,
  DEFAULT_MOBILE_HUB_PORT,
  MobileHubLanDiscovery,
  parseArpIpv4Hosts,
  probeMobileHubHealth,
  verifyMobileHubEndpoint,
  parseMobileHubBeacon
};
