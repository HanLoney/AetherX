const test = require("node:test");
const assert = require("node:assert/strict");
const { PeerTransport } = require("../src/modules/replication/peer-transport");

function createTransport(fetchImpl, options = {}) {
  const endpoint = {
    id: "endpoint-1",
    transport: "lan",
    address: "http://127.0.0.1:4319"
  };
  const calls = { successes: 0, failures: 0, touches: 0, discovered: [] };
  return {
    calls,
    transport: new PeerTransport({
      endpointRepository: {
        listForNode: () => [endpoint],
        markSuccess: () => { calls.successes += 1; },
        markFailure: () => { calls.failures += 1; },
        upsertNodeEndpoint: (_spaceId, _nodeId, value) => {
          calls.discovered.push(value);
          return { id: "discovered-1", ...value };
        }
      },
      clusterService: {
        ensureSpace: () => ({
          space_id: "space-1",
          local_node_id: "desktop",
          active_node_id: "mobile",
          protocol_version: 1,
          schema_version: 42,
          epoch: 7
        })
      },
      clusterRepository: {
        findNode: () => ({ id: "mobile", revoked_at: null }),
        touchNode: () => { calls.touches += 1; }
      },
      peerAuthenticationService: { createSignedHeaders: () => ({}) },
      localEndpointProvider: options.localEndpointProvider,
      fetchImpl
    })
  };
}

test("peer transport preserves reachable remote 5xx errors and details", async () => {
  const fixture = createTransport(async () => new Response(JSON.stringify({
    error: {
      code: "LOCAL_HUB_BUSY",
      message: "Mobile Hub is busy.",
      details: { state: "integrity_check" }
    }
  }), {
    status: 503,
    headers: { "Content-Type": "application/json" }
  }));

  await assert.rejects(
    fixture.transport.requestJson("user-1", "mobile", {
      method: "POST",
      path: "/api/v1/peer/switch/control",
      body: {}
    }),
    (error) => {
      assert.equal(error.status, 503);
      assert.equal(error.code, "LOCAL_HUB_BUSY");
      assert.deepEqual(error.details.remote, { state: "integrity_check" });
      assert.equal(error.details.attempts[0].remote, true);
      return true;
    }
  );
  assert.deepEqual(fixture.calls, { successes: 1, failures: 0, touches: 1, discovered: [] });
});

test("peer hello carries the desktop's current endpoints", async () => {
  let requestBody;
  const fixture = createTransport(async (_url, input) => {
    requestBody = JSON.parse(input.body);
    return new Response(JSON.stringify({ data: {} }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }, {
    localEndpointProvider: () => [{
      transport: "lan",
      address: "http://172.31.17.73:4318",
      priority: 500
    }]
  });

  await fixture.transport.requestJson("user-1", "mobile", {
    method: "POST",
    path: "/api/v1/peer/hello",
    body: { nodeId: "desktop" }
  });

  assert.deepEqual(requestBody, {
    nodeId: "desktop",
    endpoints: [{
      transport: "lan",
      address: "http://172.31.17.73:4318",
      priority: 500
    }]
  });
});

test("peer transport validates a response before marking its endpoint healthy", async () => {
  const fixture = createTransport(async () => new Response(JSON.stringify({
    data: { spaceId: "wrong-space", localNodeId: "mobile" }
  }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  }));

  await assert.rejects(
    fixture.transport.requestJson("user-1", "mobile", {
      method: "GET",
      path: "/api/v1/peer/status",
      validateResponse() {
        const error = new Error("identity mismatch");
        error.code = "PEER_IDENTITY_MISMATCH";
        throw error;
      }
    }),
    (error) => {
      assert.equal(error.code, "PEER_UNREACHABLE");
      assert.equal(error.details.attempts[0].code, "PEER_IDENTITY_MISMATCH");
      return true;
    }
  );
  assert.deepEqual(fixture.calls, { successes: 0, failures: 1, touches: 0, discovered: [] });
});

test("peer transport authenticates a discovered mobile endpoint before persistence", async () => {
  let requestBody;
  const fixture = createTransport(async (url, input) => {
    assert.equal(String(url), "http://192.168.8.21:4319/api/v1/peer/hello");
    requestBody = JSON.parse(input.body);
    return new Response(JSON.stringify({
      data: {
        spaceId: "space-1",
        nodeId: "mobile",
        activeNodeId: "mobile",
        epoch: 7
      }
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }, {
    localEndpointProvider: () => [{
      transport: "lan",
      address: "http://192.168.8.2:4318",
      priority: 500
    }]
  });
  const endpoint = {
    transport: "lan",
    address: "http://192.168.8.21:4319",
    priority: 900,
    certificateFingerprint: ""
  };

  const discovered = await fixture.transport.discoverEndpoint("user-1", "mobile", endpoint);

  assert.equal(discovered.id, "discovered-1");
  assert.equal(requestBody.nodeId, "desktop");
  assert.equal(requestBody.activeNodeId, "mobile");
  assert.deepEqual(requestBody.endpoints, [{
    transport: "lan",
    address: "http://192.168.8.2:4318",
    priority: 500
  }]);
  assert.deepEqual(fixture.calls.discovered, [endpoint]);
  assert.equal(fixture.calls.touches, 1);
});

test("peer transport rejects a discovered endpoint with another Hub identity", async () => {
  const fixture = createTransport(async () => new Response(JSON.stringify({
    data: {
      spaceId: "space-1",
      nodeId: "unexpected-mobile",
      activeNodeId: "unexpected-mobile",
      epoch: 7
    }
  }), { status: 200, headers: { "Content-Type": "application/json" } }));

  await assert.rejects(
    () => fixture.transport.discoverEndpoint("user-1", "mobile", {
      transport: "lan",
      address: "http://192.168.8.21:4319",
      priority: 900,
      certificateFingerprint: ""
    }),
    (error) => error.code === "PEER_IDENTITY_MISMATCH"
  );
  assert.deepEqual(fixture.calls.discovered, []);
});
