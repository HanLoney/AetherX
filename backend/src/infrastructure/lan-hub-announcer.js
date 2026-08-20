const dgram = require("node:dgram");
const os = require("node:os");

const DISCOVERY_PORT = 4317;
const ANNOUNCE_INTERVAL_MS = 5000;
const DISCOVERY_TYPE = "aetherx-hub-discovery";

class LanHubAnnouncer {
  constructor({
    hubPort,
    intervalMs = ANNOUNCE_INTERVAL_MS,
    socketFactory = () => dgram.createSocket("udp4"),
    networkInterfaces = () => os.networkInterfaces(),
    setIntervalImpl = setInterval,
    clearIntervalImpl = clearInterval
  }) {
    this.hubPort = Number(hubPort);
    this.intervalMs = intervalMs;
    this.socketFactory = socketFactory;
    this.networkInterfaces = networkInterfaces;
    this.setIntervalImpl = setIntervalImpl;
    this.clearIntervalImpl = clearIntervalImpl;
    this.socket = null;
    this.timer = null;
  }

  start() {
    if (this.socket) return;
    const socket = this.socketFactory();
    this.socket = socket;
    socket.on("error", () => {});
    socket.bind(0, "0.0.0.0", () => {
      if (this.socket !== socket) return;
      socket.setBroadcast(true);
      this.announce();
      this.timer = this.setIntervalImpl(() => this.announce(), this.intervalMs);
      this.timer?.unref?.();
    });
  }

  announce() {
    if (!this.socket) return;
    const payload = Buffer.from(JSON.stringify({
      type: DISCOVERY_TYPE,
      version: 1,
      platform: "desktop",
      port: this.hubPort
    }));
    for (const address of privateBroadcastAddresses(this.networkInterfaces())) {
      this.socket.send(payload, DISCOVERY_PORT, address, () => {});
    }
  }

  endpoints() {
    return privateLanEndpoints(this.networkInterfaces(), this.hubPort);
  }

  close() {
    if (this.timer) this.clearIntervalImpl(this.timer);
    this.timer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.close();
  }
}

function privateBroadcastAddresses(interfaces) {
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    if (/(?:vmware|virtualbox|vethernet|hyper-v|wsl|docker|loopback|tailscale)/i.test(name)) continue;
    for (const entry of entries || []) {
      const family = typeof entry.family === "string" ? entry.family : entry.family === 4 ? "IPv4" : "";
      if (family !== "IPv4" || entry.internal || !isPrivateIpv4(entry.address)) continue;
      const address = ipv4ToInt(entry.address);
      const netmask = ipv4ToInt(entry.netmask);
      if (address === null || netmask === null) continue;
      addresses.push(intToIpv4(((address & netmask) | (~netmask >>> 0)) >>> 0));
    }
  }
  return [...new Set(addresses)];
}

function privateLanEndpoints(interfaces, port) {
  const addresses = [];
  for (const [name, entries] of Object.entries(interfaces || {})) {
    if (/(?:vmware|virtualbox|vethernet|hyper-v|wsl|docker|loopback|tailscale)/i.test(name)) continue;
    for (const entry of entries || []) {
      const family = typeof entry.family === "string" ? entry.family : entry.family === 4 ? "IPv4" : "";
      if (family !== "IPv4" || entry.internal || !isPrivateIpv4(entry.address)) continue;
      addresses.push(entry.address);
    }
  }
  return [...new Set(addresses)].map((address, index) => ({
    transport: "lan",
    address: `http://${address}:${Number(port)}`,
    priority: 500 - index,
    certificateFingerprint: ""
  }));
}

function isPrivateIpv4(value) {
  const parts = String(value || "").split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) && (
    parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168)
  );
}

function ipv4ToInt(value) {
  const parts = String(value || "").split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts.reduce((result, part) => ((result << 8) | part) >>> 0, 0);
}

function intToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

module.exports = {
  ANNOUNCE_INTERVAL_MS,
  DISCOVERY_PORT,
  DISCOVERY_TYPE,
  LanHubAnnouncer,
  privateBroadcastAddresses,
  privateLanEndpoints
};
