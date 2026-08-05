const MOBILE_PLATFORMS = new Set(["android", "ios"]);

async function loadMobileHubStatus({ api, cachedCluster = null, timeoutMs = 1200 }) {
  const [cluster, detail] = await Promise.all([
    settleWithin(api.getClusterStatus(), timeoutMs, cachedCluster),
    settleWithin(api.listMobileHubs(), timeoutMs, { hubs: [] })
  ]);
  return {
    cluster,
    hubs: mergeMobileHubStatus(cluster, detail?.hubs)
  };
}

function mergeMobileHubStatus(cluster, detailedHubs = []) {
  const details = Array.isArray(detailedHubs) ? detailedHubs : [];
  const detailById = new Map(details.map((hub) => [String(hub.id || ""), hub]));
  const nodes = Array.isArray(cluster?.nodes) ? cluster.nodes : [];
  const merged = nodes
    .filter((node) => isMobileHubNode(node))
    .map((node) => mergeHubNode(cluster, node, detailById.get(String(node.id || ""))));
  const knownIds = new Set(merged.map((hub) => String(hub.id || "")));
  for (const detail of details) {
    if (!detail?.id || knownIds.has(String(detail.id))) continue;
    merged.push(mergeHubNode(cluster, detail, detail));
  }
  return merged;
}

function mergeHubNode(cluster, node, detail = null) {
  const id = String(node?.id || detail?.id || "");
  const status = String(node?.status || detail?.status || "");
  const activeNodeId = String(cluster?.activeNodeId || "");
  const active = activeNodeId
    ? id !== "" && id === activeNodeId
    : detail?.active === true || node?.active === true || status === "active";
  return {
    ...(node || {}),
    ...(detail || {}),
    id,
    status,
    role: active ? "active" : "standby",
    active,
    ready: active ? false : detail?.ready === true || (
      status === "standby" && cluster?.replication?.ready === true
    )
  };
}

function isMobileHubNode(node) {
  const platform = String(node?.platform || "").toLowerCase();
  const id = String(node?.id || "").toLowerCase();
  return MOBILE_PLATFORMS.has(platform) || /^(android|ios)-/.test(id);
}

function settleWithin(promise, timeoutMs, fallback) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(1, Number(timeoutMs) || 1));
    timer.unref?.();
  });
  return Promise.race([
    Promise.resolve(promise).catch(() => fallback),
    timeout
  ]).finally(() => clearTimeout(timer));
}

module.exports = {
  isMobileHubNode,
  loadMobileHubStatus,
  mergeMobileHubStatus
};
