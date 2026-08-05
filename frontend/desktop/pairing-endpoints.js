const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const execFileAsync = promisify(execFile);
const LOCAL_HUB_TARGET = "http://127.0.0.1:4318";

function normalizeEndpoint(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (["127.0.0.1", "localhost", "::1", "[::1]"].includes(url.hostname)) return null;
    return {
      transport: url.protocol === "https:" ? "anywhere" : "lan",
      address: url.origin,
      priority: url.protocol === "https:" ? 300 : 400
    };
  } catch {
    return null;
  }
}

function discoverLanEndpoints(options = {}) {
  const port = Number(options.port || portFromUrl(options.serverUrl) || 4318);
  const interfaces = options.networkInterfaces || os.networkInterfaces();
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    if (isVirtualInterfaceName(name)) continue;
    for (const entry of entries || []) {
      const family = typeof entry.family === "string"
        ? entry.family
        : entry.family === 4 ? "IPv4" : "";
      if (family !== "IPv4" || entry.internal || !isPrivateIpv4(entry.address)) continue;
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)].map((address, index) => ({
    transport: "lan",
    address: `http://${address}:${port}`,
    priority: 500 - index
  }));
}

function isVirtualInterfaceName(value) {
  return /(?:vmware|virtualbox|vethernet|hyper-v|wsl|docker|loopback)/i.test(String(value || ""));
}

function portFromUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.port || (url.protocol === "https:" ? 443 : 80);
  } catch {
    return 0;
  }
}

function isPrivateIpv4(value) {
  const parts = String(value || "").split(".").map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) return false;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function inspectTailscaleServe(payload, target = LOCAL_HUB_TARGET) {
  for (const [hostPort, web] of Object.entries(payload?.Web || {})) {
    if (web?.Handlers?.["/"]?.Proxy !== target) continue;
    const port = String(hostPort).split(":").pop();
    if (payload?.TCP?.[port]?.HTTPS === true) return `https://${hostPort}`;
  }
  return "";
}

async function findTailscaleExecutable(options = {}) {
  const environment = options.env || process.env;
  const access = options.access || fs.promises.access;
  const candidates = [
    environment.AETHERX_TAILSCALE_PATH,
    environment.ProgramFiles && path.join(environment.ProgramFiles, "Tailscale", "tailscale.exe"),
    environment["ProgramFiles(x86)"] && path.join(environment["ProgramFiles(x86)"], "Tailscale", "tailscale.exe"),
    environment.LOCALAPPDATA && path.join(environment.LOCALAPPDATA, "Tailscale", "tailscale.exe")
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through standard install locations.
    }
  }
  try {
    const result = await (options.execFileImpl || execFileAsync)("where.exe", ["tailscale.exe"], {
      windowsHide: true,
      timeout: 2500
    });
    return String(result.stdout || "").split(/\r?\n/).map((item) => item.trim()).find(Boolean) || "";
  } catch {
    return "";
  }
}

async function discoverHubPairingEndpoints(options = {}) {
  const endpoints = discoverLanEndpoints(options);
  const serverEndpoint = normalizeEndpoint(options.serverUrl);
  if (serverEndpoint && !endpoints.some((item) => item.address === serverEndpoint.address)) {
    endpoints.push(serverEndpoint);
  }

  const executable = options.executable || await findTailscaleExecutable(options);
  if (executable) {
    try {
      const result = await (options.execFileImpl || execFileAsync)(
        executable,
        ["serve", "status", "--json"],
        { windowsHide: true, timeout: 5000, maxBuffer: 1024 * 1024 }
      );
      const url = inspectTailscaleServe(JSON.parse(String(result.stdout || "{}")));
      if (url && !endpoints.some((item) => item.address === url)) {
        endpoints.push({ transport: "anywhere", address: url, priority: 300 });
      }
    } catch {
      // A non-Tailscale reachable server URL can still be used.
    }
  }
  return endpoints.sort((left, right) => right.priority - left.priority);
}

module.exports = {
  LOCAL_HUB_TARGET,
  discoverLanEndpoints,
  discoverHubPairingEndpoints,
  findTailscaleExecutable,
  inspectTailscaleServe,
  normalizeEndpoint,
  isPrivateIpv4
};
