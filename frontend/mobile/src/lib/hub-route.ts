export interface HubRouteNode {
  nodeId: string;
  serverUrl: string;
}

export interface HubRouteEndpoint {
  nodeId?: string;
  address: string;
  priority?: number;
}

export function hubRouteCandidates(
  route: HubRouteNode,
  endpoints: ReadonlyArray<HubRouteEndpoint> = []
) {
  const alternatives = endpoints
    .filter((endpoint) => !endpoint.nodeId || endpoint.nodeId === route.nodeId)
    .sort((left, right) => Number(right.priority || 0) - Number(left.priority || 0))
    .map((endpoint) => endpoint.address);
  return [...new Set([route.serverUrl, ...alternatives]
    .map(normalizeHubUrl)
    .filter((url) => /^https?:\/\//i.test(url)))];
}

function normalizeHubUrl(value: string) {
  return String(value || "").trim().replace(/\/+$/, "");
}
