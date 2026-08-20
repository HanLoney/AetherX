const assert = require("node:assert/strict");
const test = require("node:test");
const {
  MobileHubLanDiscovery,
  parseArpIpv4Hosts,
  probeMobileHubHealth,
  verifyMobileHubEndpoint,
  parseMobileHubBeacon
} = require("../mobile-hub-lan-discovery");

test("desktop accepts only private Android Local Hub beacons", () => {
  const payload = Buffer.from(JSON.stringify({
    type: "aetherx-hub-discovery",
    version: 1,
    platform: "android",
    port: 4319
  }));
  assert.deepEqual(parseMobileHubBeacon(payload, { address: "192.168.8.21" }), {
    transport: "lan",
    address: "http://192.168.8.21:4319",
    priority: 900,
    certificateFingerprint: ""
  });
  assert.equal(parseMobileHubBeacon(payload, { address: "8.8.8.8" }), null);
  assert.equal(parseMobileHubBeacon(Buffer.from(JSON.stringify({
    type: "aetherx-hub-discovery",
    version: 1,
    platform: "desktop",
    port: 4318
  })), { address: "192.168.8.2" }), null);
});

test("desktop caches a fresh Android Hub candidate and wakes login recovery", async () => {
  const handlers = {};
  const socket = {
    on(event, handler) { handlers[event] = handler; },
    bind(port, host) {
      assert.equal(port, 4317);
      assert.equal(host, "0.0.0.0");
    },
    close() {}
  };
  let now = 1000;
  const discovery = new MobileHubLanDiscovery({
    socketFactory: () => socket,
    now: () => now
  });
  discovery.start();
  const waiting = discovery.waitForCandidates(1000);
  handlers.message(Buffer.from(JSON.stringify({
    type: "aetherx-hub-discovery",
    version: 1,
    platform: "android",
    port: 4320
  })), { address: "172.31.17.114" });
  assert.deepEqual(await waiting, [{
    transport: "lan",
    address: "http://172.31.17.114:4320",
    priority: 900,
    certificateFingerprint: ""
  }]);
  now += 21_000;
  assert.deepEqual(discovery.candidates(), []);
  discovery.close();
});

test("desktop extracts only private unicast hosts from the system neighbor table", () => {
  assert.deepEqual(parseArpIpv4Hosts(`
Interface: 172.31.17.73 --- 0x4
  172.31.17.146       32-6a-05-67-26-da     dynamic
  172.31.31.255       ff-ff-ff-ff-ff-ff     static
  224.0.0.251         01-00-5e-00-00-fb     static
  8.8.8.8             00-00-00-00-00-00     dynamic
  172.31.17.146       32-6a-05-67-26-da     dynamic
  `), ["172.31.17.73", "172.31.17.146"]);
});

test("desktop verifies an Android Hub health response before accepting a probed endpoint", async () => {
  const endpoint = await probeMobileHubHealth(async (url) => {
    assert.equal(url, "http://172.31.17.146:4319/health");
    return new Response(JSON.stringify({ data: { service: "aetherx-android-local-hub" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }, "172.31.17.146", 4319);
  assert.deepEqual(endpoint, {
    transport: "lan",
    address: "http://172.31.17.146:4319",
    priority: 850,
    certificateFingerprint: ""
  });
  assert.equal(await probeMobileHubHealth(async () => new Response(JSON.stringify({
    data: { service: "not-aetherx" }
  }), { status: 200 }), "172.31.17.22", 4319), null);
});

test("desktop verifies a discovered mobile Hub endpoint before showing it online", async () => {
  let now = 100;
  const verified = await verifyMobileHubEndpoint(async (url) => {
    assert.equal(url, "http://172.31.17.146:4319/health");
    now = 112;
    return new Response(JSON.stringify({ data: { service: "aetherx-android-local-hub" } }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }, "http://172.31.17.146:4319", { now: () => now });
  assert.deepEqual(verified, {
    transport: "lan",
    address: "http://172.31.17.146:4319",
    priority: 850,
    certificateFingerprint: "",
    latencyMs: 12
  });
  assert.equal(await verifyMobileHubEndpoint(async () => {
    throw new Error("should not fetch public endpoints");
  }, "http://8.8.8.8:4319"), null);
});

test("desktop falls back to neighbor probing when Android broadcasts are blocked", async () => {
  const socket = {
    on() {},
    bind() {},
    close() {}
  };
  const requests = [];
  const discovery = new MobileHubLanDiscovery({
    socketFactory: () => socket,
    neighborProvider: async () => ["172.31.17.22", "172.31.17.146"],
    fetchImpl: async (url) => {
      requests.push(url);
      const mobile = url === "http://172.31.17.146:4319/health";
      return new Response(JSON.stringify({
        data: { service: mobile ? "aetherx-android-local-hub" : "other" }
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
  });
  discovery.start();
  const candidates = await discovery.discoverCandidates(1);
  assert.deepEqual(candidates, [{
    transport: "lan",
    address: "http://172.31.17.146:4319",
    priority: 850,
    certificateFingerprint: ""
  }]);
  assert.deepEqual(requests.sort(), [
    "http://172.31.17.146:4319/health",
    "http://172.31.17.22:4319/health"
  ]);
  discovery.close();
});
