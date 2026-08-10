const fs = require("node:fs");
const http = require("node:http");
const https = require("node:https");
const os = require("node:os");
const path = require("node:path");
const { app, safeStorage } = require("electron");
const { AuthStore } = require("../frontend/desktop/auth-store");

const root = path.resolve(__dirname, "..");
const authFile = path.resolve(
  process.env.AETHERX_DESKTOP_AUTH_FILE ||
    path.join(process.env.APPDATA || "", "aetherx-desktop", "auth.json")
);
const mobileUrl = normalizeUrl(process.env.AETHERX_MOBILE_HUB_URL || "http://127.0.0.1:4319");
const sourceUserData = path.dirname(authFile);
const temporaryUserData = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-live-smoke-"));
const localState = path.join(sourceUserData, "Local State");

if (!fs.existsSync(authFile)) throw new Error(`Desktop authentication file is missing: ${authFile}`);
if (!fs.existsSync(localState)) throw new Error(`Desktop Local State is missing: ${localState}`);
fs.copyFileSync(localState, path.join(temporaryUserData, "Local State"));
app.setPath("userData", temporaryUserData);

function normalizeUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function isMobileHubUrl(value) {
  try {
    const url = new URL(normalizeUrl(value));
    const port = Number(url.port || (url.protocol === "https:" ? 443 : 80));
    return port >= 4319 && port <= 4329;
  } catch {
    return false;
  }
}

async function request(baseUrl, token, pathname, options = {}) {
  const target = `${normalizeUrl(baseUrl)}${pathname}`;
  const url = new URL(target);
  const transport = url.protocol === "https:" ? https : http;
  const method = String(options.method || "GET").toUpperCase();
  const body = options.body === undefined ? "" : JSON.stringify(options.body);
  const response = await new Promise((resolve, reject) => {
    const pending = transport.request(url, {
      method,
      agent: false,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        } : {})
      }
    }, (incoming) => {
      const chunks = [];
      incoming.on("data", (chunk) => chunks.push(chunk));
      incoming.on("end", () => resolve({
        ok: incoming.statusCode >= 200 && incoming.statusCode < 300,
        status: incoming.statusCode,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 8_000);
    pending.setTimeout(timeoutMs, () => pending.destroy(new Error("request timed out")));
    pending.on("error", reject);
    if (body) pending.write(body);
    pending.end();
  }).catch((error) => {
    throw new Error(`${target} failed: ${error.message}`);
  });
  let payload = {};
  try { payload = JSON.parse(response.body); } catch {}
  if (!response.ok) {
    const code = payload?.error?.code || `HTTP_${response.status}`;
    const details = payload?.error?.details;
    throw new Error(
      `${pathname} failed: ${code}${details ? ` ${JSON.stringify(details)}` : ""}`
    );
  }
  return payload?.data;
}

function clusterSummary(cluster) {
  if (!cluster) return null;
  return {
    spaceId: cluster.spaceId,
    localNodeId: cluster.localNodeId,
    activeNodeId: cluster.activeNodeId,
    epoch: cluster.epoch,
    state: cluster.state,
    transitionId: cluster.transitionId || "",
    replication: cluster.replication || null,
    nodes: Array.isArray(cluster.nodes)
      ? cluster.nodes.map((node) => ({
          id: node.id,
          role: node.role,
          status: node.status,
          ready: node.ready,
          lastSeenAt: node.lastSeenAt
        }))
      : []
  };
}

function hubSummary(hub) {
  return {
    id: hub.id,
    active: hub.active,
    ready: hub.ready,
    status: hub.status,
    syncStatus: hub.syncStatus,
    progress: hub.progress,
    operations: hub.operations,
    media: hub.media,
    client: hub.client
      ? {
          id: hub.client.id,
          status: hub.client.status,
          syncStatus: hub.client.syncStatus,
          sseConnected: hub.client.sseConnected,
          lastHeartbeatAt: hub.client.lastHeartbeatAt
        }
      : null
  };
}

async function waitFor(label, task, predicate, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (Date.now() < deadline) {
    try {
      latest = await task();
      if (predicate(latest)) return latest;
    } catch (error) {
      latest = { error: error.message };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_500));
  }
  throw new Error(`${label} timed out: ${JSON.stringify(latest)}`);
}

async function runSwitchCycle({ desktopBaseUrl, desktopToken, hub }) {
  const switchPath = `/api/v1/cluster/mobile-hubs/${encodeURIComponent(hub.id)}/switch`;
  const toMobileRequest = await request(desktopBaseUrl, desktopToken, switchPath, {
    method: "POST",
    body: {},
    timeoutMs: 300_000
  });
  const mobileActive = await waitFor("switch to mobile Hub", async () => {
    const [cluster, hubs] = await Promise.all([
      request(desktopBaseUrl, desktopToken, "/api/v1/cluster/status"),
      request(desktopBaseUrl, desktopToken, "/api/v1/cluster/mobile-hubs")
    ]);
    return { cluster, hubs };
  }, ({ cluster, hubs }) =>
    cluster?.state === "stable" &&
    cluster.activeNodeId === hub.id &&
    Array.isArray(hubs?.hubs) &&
    hubs.hubs.some((item) => item.id === hub.id && item.active)
  );

  const toDesktopRequest = await request(desktopBaseUrl, desktopToken, switchPath, {
    method: "POST",
    body: {},
    timeoutMs: 300_000
  });
  const desktopActive = await waitFor("switch back to desktop Hub", async () => {
    const [cluster, hubs] = await Promise.all([
      request(desktopBaseUrl, desktopToken, "/api/v1/cluster/status"),
      request(desktopBaseUrl, desktopToken, "/api/v1/cluster/mobile-hubs")
    ]);
    return { cluster, hubs };
  }, ({ cluster, hubs }) =>
    cluster?.state === "stable" &&
    cluster.activeNodeId === cluster.localNodeId &&
    Array.isArray(hubs?.hubs) &&
    hubs.hubs.some((item) => item.id === hub.id && item.ready && !item.active)
  );

  return {
    toMobileRequest,
    mobileActive: {
      activeNodeId: mobileActive.cluster.activeNodeId,
      epoch: mobileActive.cluster.epoch,
      state: mobileActive.cluster.state
    },
    toDesktopRequest,
    desktopActive: {
      activeNodeId: desktopActive.cluster.activeNodeId,
      epoch: desktopActive.cluster.epoch,
      state: desktopActive.cluster.state
    }
  };
}

async function main() {
  await app.whenReady();
  const stored = new AuthStore(authFile, safeStorage).load();
  if (!stored.token || !stored.user || !stored.routing?.spaceId) {
    throw new Error("Desktop authentication or Hub routing is unavailable.");
  }

  const desktopNode = stored.routing.nodes.find(
    (node) => !isMobileHubUrl(node.serverUrl) && node.token
  );
  const mobileNode = stored.routing.nodes.find(
    (node) => isMobileHubUrl(node.serverUrl) && node.token
  );
  const desktopBaseUrl = normalizeUrl(desktopNode?.serverUrl || stored.serverUrl);
  const desktopToken = desktopNode?.token || stored.token;
  if (!desktopBaseUrl || !desktopToken) throw new Error("Desktop Hub session is unavailable.");

  const desktopHealth = await request(desktopBaseUrl, "", "/health");
  if (process.env.AETHERX_RECOVER_SWITCH === "1") {
    const requested = await request(
      desktopBaseUrl,
      desktopToken,
      "/api/v1/cluster/switch/recover",
      { method: "POST", body: {} }
    );
    const recovered = await waitFor("switch state recovery", async () =>
      request(desktopBaseUrl, desktopToken, "/api/v1/cluster/status"),
    (cluster) => cluster?.state === "stable" && cluster.activeNodeId === cluster.localNodeId);
    console.log(JSON.stringify({
      desktop: { health: desktopHealth, cluster: clusterSummary(recovered) },
      switchRecovery: requested
    }, null, 2));
    return;
  }
  if (process.env.AETHERX_SWITCH_BACK === "1") {
    if (!mobileNode?.nodeId) throw new Error("The persisted mobile Hub node is unavailable.");
    const switchPath = `/api/v1/cluster/mobile-hubs/${encodeURIComponent(mobileNode.nodeId)}/switch`;
    const requested = await request(desktopBaseUrl, desktopToken, switchPath, {
      method: "POST",
      body: {},
      timeoutMs: 300_000
    });
    const recovered = await waitFor("switch-back recovery", async () =>
      request(desktopBaseUrl, desktopToken, "/api/v1/cluster/status"),
    (cluster) => cluster?.state === "stable" && cluster.activeNodeId === cluster.localNodeId);
    console.log(JSON.stringify({
      desktop: { health: desktopHealth, cluster: clusterSummary(recovered) },
      switchBackRecovery: requested
    }, null, 2));
    return;
  }
  const desktopCluster = await request(desktopBaseUrl, desktopToken, "/api/v1/cluster/status");
  const mobileHubs = await request(
    desktopBaseUrl,
    desktopToken,
    "/api/v1/cluster/mobile-hubs"
  );
  const deviceHealth = await request(desktopBaseUrl, desktopToken, "/api/v1/devices/health");
  const recovery = await request(
    desktopBaseUrl,
    desktopToken,
    "/api/v1/cluster/switch/recovery"
  );

  const result = {
    desktop: {
      health: desktopHealth,
      cluster: clusterSummary(desktopCluster),
      mobileHubs: Array.isArray(mobileHubs?.hubs) ? mobileHubs.hubs.map(hubSummary) : [],
      deviceHealth,
      switchRecovery: recovery
    },
    mobile: {
      health: await request(mobileUrl, "", "/health"),
      cluster: null,
      standbyProtected: false
    },
    agreement: null,
    switchCycle: null,
    routing: stored.routing.nodes.map((node) => ({
      nodeId: node.nodeId,
      serverUrl: node.serverUrl,
      lastSeenAt: node.lastSeenAt
    }))
  };

  if (!mobileNode?.token) {
    throw new Error("No persisted mobile Hub session is available for authenticated validation.");
  }
  if (process.env.AETHERX_SWITCH_CYCLE === "1") {
    const hub = mobileHubs?.hubs?.find((item) => item.ready);
    if (!hub) throw new Error("No ready mobile Hub is available for a switch cycle.");
    result.switchCycle = await runSwitchCycle({
      desktopBaseUrl,
      desktopToken,
      hub
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  let mobileCluster;
  try {
    mobileCluster = await request(
      mobileUrl,
      mobileNode.token,
      "/api/v1/cluster/status"
    );
  } catch (error) {
    if (!/HUB_NOT_ACTIVE/.test(error.message)) throw error;
    result.mobile.standbyProtected = true;
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  result.mobile.cluster = clusterSummary(mobileCluster);
  result.agreement = {
    sameSpace: desktopCluster.spaceId === mobileCluster.spaceId,
    sameActiveNode: desktopCluster.activeNodeId === mobileCluster.activeNodeId,
    sameEpoch: Number(desktopCluster.epoch) === Number(mobileCluster.epoch),
    stable: desktopCluster.state === "stable" && mobileCluster.state === "stable"
  };

  console.log(JSON.stringify(result, null, 2));
  if (Object.values(result.agreement).some((value) => value !== true)) {
    throw new Error("Desktop and mobile Hub authority state does not agree.");
  }
}

main()
  .catch((error) => {
    console.error(`Dual Hub live smoke failed: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    app.quit();
    fs.rmSync(temporaryUserData, { recursive: true, force: true });
  });
