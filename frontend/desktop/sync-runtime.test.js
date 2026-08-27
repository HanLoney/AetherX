const test = require("node:test");
const assert = require("node:assert/strict");
const {
  DesktopControlCoordinator,
  DesktopSyncCoordinator,
  parseEventStream
} = require("./sync-runtime");

test("启动时追到最新游标，但不重复广播历史变更", async () => {
  const pages = [
    { changes: [{ seq: 1 }], nextCursor: 1, hasMore: true },
    { changes: [{ seq: 2 }], nextCursor: 2, hasMore: false }
  ];
  const received = [];
  const coordinator = new DesktopSyncCoordinator({
    api: { listSyncChanges: async () => pages.shift() },
    onChanges: (changes) => received.push(...changes),
    pollIntervalMs: 60_000
  });
  await coordinator.start("server:user");
  assert.equal(coordinator.cursor, 2);
  coordinator.stop();
  assert.deepEqual(received, []);
});

test("运行后合并分页变更并广播一次", async () => {
  const pages = [
    { changes: [], nextCursor: 3, hasMore: false },
    { changes: [{ seq: 4 }], nextCursor: 4, hasMore: true },
    { changes: [{ seq: 5 }], nextCursor: 5, hasMore: false }
  ];
  const received = [];
  const coordinator = new DesktopSyncCoordinator({
    api: { listSyncChanges: async () => pages.shift() },
    onChanges: (changes) => received.push(changes),
    pollIntervalMs: 60_000
  });
  await coordinator.start("server:user");
  await coordinator.pollNow();
  coordinator.stop();
  assert.deepEqual(received, [[{ seq: 4 }, { seq: 5 }]]);
});

test("desktop sync receives cloud changes from the realtime SSE stream", async () => {
  const encoder = new TextEncoder();
  const received = [];
  let request;
  const coordinator = new DesktopSyncCoordinator({
    api: {
      baseUrl: "https://api.aetherx.test",
      token: "desktop-token",
      listSyncChanges: async () => ({ changes: [], nextCursor: 8, hasMore: false })
    },
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode(
            "id: 9\nevent: change\ndata: {\"seq\":9,\"entityType\":\"messages\"}\n\n"
          ));
        }
      }), { status: 200 });
    },
    onChanges: (changes) => {
      received.push(...changes);
      coordinator.stop();
    },
    realtime: true
  });

  await coordinator.start("cloud:user-1");
  await waitFor(() => received.length === 1);

  assert.match(request.url, /\/api\/v1\/sync\/events\?after=8/);
  assert.equal(request.options.headers.Authorization, "Bearer desktop-token");
  assert.equal(received[0].seq, 9);
});

test("desktop control stream parses split SSE events", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("id: 7\r\nevent: cluster-"));
      controller.enqueue(encoder.encode("change\r\ndata: {\"state\":\"stable\",\r\n"));
      controller.enqueue(encoder.encode("data: \"epoch\":13}\r\n\r\n"));
      controller.close();
    }
  });
  const events = [];
  await parseEventStream(stream, (event) => events.push(event));
  assert.deepEqual(events, [{
    event: "cluster-change",
    data: "{\"state\":\"stable\",\n\"epoch\":13}",
    id: "7"
  }]);
});

test("desktop control stream retries the authentication Hub and delivers cluster changes", async () => {
  const encoder = new TextEncoder();
  const requests = [];
  const delays = [];
  const received = [];
  let coordinator;
  const fetchImpl = async (url, options) => {
    requests.push({ url: String(url), options });
    if (requests.length === 1) throw new Error("offline");
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(
          "event: cluster-change\ndata: {\"cluster\":{\"state\":\"stable\",\"epoch\":13}}\n\n"
        ));
        controller.close();
      }
    }), { status: 200 });
  };
  coordinator = new DesktopControlCoordinator({
    fetchImpl,
    random: () => 0,
    waitImpl: async (delay) => delays.push(delay),
    onEvent: (event) => {
      received.push(event);
      coordinator.stop();
    }
  });
  coordinator.start({
    baseUrl: "http://127.0.0.1:4318/",
    token: "desktop-token",
    clientId: "desktop:user-1"
  });
  await waitFor(() => received.length === 1);

  assert.equal(requests.length, 2);
  assert.equal(
    requests[0].url,
    "http://127.0.0.1:4318/api/v1/sync/events?control_only=1&client_id=desktop%3Auser-1"
  );
  assert.equal(requests[0].options.headers.Authorization, "Bearer desktop-token");
  assert.deepEqual(delays, [1000]);
  assert.equal(received[0].event, "cluster-change");
  assert.equal(received[0].data.cluster.epoch, 13);
});

test("stopping the desktop control stream aborts its active request", async () => {
  let requestSignal;
  const coordinator = new DesktopControlCoordinator({
    fetchImpl: (_url, options) => new Promise((_resolve, reject) => {
      requestSignal = options.signal;
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    })
  });
  coordinator.start({
    baseUrl: "http://127.0.0.1:4318",
    token: "desktop-token"
  });
  await waitFor(() => Boolean(requestSignal));
  coordinator.stop();
  assert.equal(requestSignal.aborted, true);
  assert.equal(coordinator.running, false);
});

async function waitFor(predicate, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) throw new Error("Timed out waiting for condition.");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
