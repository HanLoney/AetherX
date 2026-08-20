const assert = require("node:assert/strict");
const test = require("node:test");
const {
  DISCOVERY_PORT,
  DISCOVERY_TYPE,
  LanHubAnnouncer,
  privateBroadcastAddresses,
  privateLanEndpoints
} = require("../src/infrastructure/lan-hub-announcer");

test("LAN Hub discovery only targets physical private-network broadcasts", () => {
  assert.deepEqual(privateBroadcastAddresses({
    WLAN: [{ family: "IPv4", address: "172.31.17.66", netmask: "255.255.252.0", internal: false }],
    Ethernet: [{ family: 4, address: "192.168.1.20", netmask: "255.255.255.0", internal: false }],
    Tailscale: [{ family: "IPv4", address: "100.64.0.1", netmask: "255.192.0.0", internal: false }],
    VMware: [{ family: "IPv4", address: "192.168.76.1", netmask: "255.255.255.0", internal: false }]
  }), ["172.31.19.255", "192.168.1.255"]);
});

test("LAN Hub endpoints use current physical private addresses", () => {
  assert.deepEqual(privateLanEndpoints({
    WLAN: [{ family: "IPv4", address: "172.31.17.73", netmask: "255.255.252.0", internal: false }],
    Tailscale: [{ family: "IPv4", address: "100.64.0.1", netmask: "255.192.0.0", internal: false }],
    VMware: [{ family: "IPv4", address: "192.168.76.1", netmask: "255.255.255.0", internal: false }]
  }, 4318), [{
    transport: "lan",
    address: "http://172.31.17.73:4318",
    priority: 500,
    certificateFingerprint: ""
  }]);
});

test("LAN Hub announcer emits a credential-free beacon and closes cleanly", () => {
  const sends = [];
  let closed = false;
  let timerCleared = false;
  const socket = {
    on() {},
    bind(_port, _host, callback) { callback(); },
    setBroadcast(value) { assert.equal(value, true); },
    send(payload, port, address, callback) {
      sends.push({ payload: JSON.parse(payload.toString("utf8")), port, address });
      callback();
    },
    close() { closed = true; }
  };
  const announcer = new LanHubAnnouncer({
    hubPort: 4318,
    socketFactory: () => socket,
    networkInterfaces: () => ({
      WLAN: [{ family: "IPv4", address: "192.168.8.2", netmask: "255.255.255.0", internal: false }]
    }),
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl: () => { timerCleared = true; }
  });

  announcer.start();
  assert.deepEqual(sends, [{
    payload: { type: DISCOVERY_TYPE, version: 1, platform: "desktop", port: 4318 },
    port: DISCOVERY_PORT,
    address: "192.168.8.255"
  }]);
  announcer.close();
  assert.equal(timerCleared, true);
  assert.equal(closed, true);
});
