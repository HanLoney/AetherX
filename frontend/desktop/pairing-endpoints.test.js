const test = require("node:test");
const assert = require("node:assert/strict");
const {
  discoverLanEndpoints,
  discoverHubPairingEndpoints,
  inspectTailscaleServe,
  normalizeEndpoint
} = require("./pairing-endpoints");

test("手机 Hub 配对不会发布仅电脑自身可见的回环地址", () => {
  assert.equal(normalizeEndpoint("http://127.0.0.1:4318"), null);
  assert.deepEqual(normalizeEndpoint("https://hub.example.ts.net:4318/"), {
    transport: "anywhere",
    address: "https://hub.example.ts.net:4318",
    priority: 300
  });
});

test("局域网地址优先，并忽略回环和公网网卡", () => {
  assert.deepEqual(discoverLanEndpoints({
    serverUrl: "http://127.0.0.1:4318",
    networkInterfaces: {
      Ethernet: [
        { family: "IPv4", address: "192.168.31.8", internal: false },
        { family: "IPv4", address: "8.8.8.8", internal: false }
      ],
      Loopback: [{ family: "IPv4", address: "127.0.0.1", internal: true }]
    }
  }), [{
    transport: "lan",
    address: "http://192.168.31.8:4318",
    priority: 500
  }]);
});

test("从 Tailscale Serve 配置识别手机可达的 HTTPS Hub 地址", () => {
  assert.equal(inspectTailscaleServe({
    TCP: { "4318": { HTTPS: true } },
    Web: {
      "loney.example.ts.net:4318": {
        Handlers: { "/": { Proxy: "http://127.0.0.1:4318" } }
      }
    }
  }), "https://loney.example.ts.net:4318");
});

test("生成备用 Hub 配对码时局域网优先、Tailscale Anywhere 兜底", async () => {
  const endpoints = await discoverHubPairingEndpoints({
    serverUrl: "http://127.0.0.1:4318",
    networkInterfaces: {
      WiFi: [{ family: "IPv4", address: "192.168.1.20", internal: false }]
    },
    executable: "tailscale.exe",
    execFileImpl: async () => ({
      stdout: JSON.stringify({
        TCP: { "4318": { HTTPS: true } },
        Web: {
          "loney.example.ts.net:4318": {
            Handlers: { "/": { Proxy: "http://127.0.0.1:4318" } }
          }
        }
      })
    })
  });
  assert.deepEqual(endpoints, [
    { transport: "lan", address: "http://192.168.1.20:4318", priority: 500 },
    { transport: "anywhere", address: "https://loney.example.ts.net:4318", priority: 300 }
  ]);
});
