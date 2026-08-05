const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const test = require("node:test");
const { SyncEventBroker } = require("../src/modules/sync/sync-event-broker");

function createStream() {
  const request = new EventEmitter();
  const response = new EventEmitter();
  response.destroyed = false;
  response.writableEnded = false;
  response.headers = new Map();
  response.output = "";
  response.setHeader = (name, value) => response.headers.set(name, value);
  response.flushHeaders = () => undefined;
  response.write = (chunk) => {
    response.output += chunk;
    return true;
  };
  response.end = () => {
    response.writableEnded = true;
  };
  return { request, response };
}

function createBroker() {
  return new SyncEventBroker({
    latestSequence: () => 0,
    listChanges: () => []
  });
}

test("在线订阅者会立即收到手机 Hub 命令", () => {
  const broker = createBroker();
  const stream = createStream();
  try {
    broker.subscribe({ ...stream, userId: "user-1" });
    const delivery = broker.publish(
      "user-1",
      "hub-command",
      { type: "synchronize-local-hub", nodeId: "android-1" },
      { queueWhenOffline: true }
    );

    assert.deepEqual(delivery, { delivered: 1, queued: false });
    assert.match(stream.response.output, /event: hub-command/);
    assert.match(stream.response.output, /"nodeId":"android-1"/);
  } finally {
    broker.close();
  }
});

test("手机离线时命令会排队并在下一次订阅时只补发一次", () => {
  const broker = createBroker();
  try {
    const delivery = broker.publish(
      "user-2",
      "hub-command",
      { type: "synchronize-local-hub", nodeId: "android-2" },
      { queueWhenOffline: true }
    );
    assert.deepEqual(delivery, { delivered: 0, queued: true });

    const first = createStream();
    broker.subscribe({ ...first, userId: "user-2" });
    assert.equal((first.response.output.match(/event: hub-command/g) || []).length, 1);

    first.request.emit("close");
    const second = createStream();
    broker.subscribe({ ...second, userId: "user-2" });
    assert.equal((second.response.output.match(/event: hub-command/g) || []).length, 0);
  } finally {
    broker.close();
  }
});

test("手机 Hub 命令只会投递给指定安装，桌面订阅不会被误算为送达", () => {
  const broker = createBroker();
  const desktop = createStream();
  const phone = createStream();
  try {
    broker.subscribe({ ...desktop, userId: "user-3", clientId: "desktop-client" });
    let delivery = broker.publish(
      "user-3",
      "hub-command",
      { type: "switch-local-hub", nodeId: "android-3" },
      { clientId: "phone-client" }
    );
    assert.deepEqual(delivery, { delivered: 0, queued: false });
    assert.doesNotMatch(desktop.response.output, /switch-local-hub/);

    broker.subscribe({ ...phone, userId: "user-3", clientId: "phone-client" });
    delivery = broker.publish(
      "user-3",
      "hub-command",
      { type: "switch-local-hub", nodeId: "android-3" },
      { clientId: "phone-client" }
    );
    assert.deepEqual(delivery, { delivered: 1, queued: false });
    assert.match(phone.response.output, /switch-local-hub/);
    assert.doesNotMatch(desktop.response.output, /switch-local-hub/);
  } finally {
    broker.close();
  }
});

test("定向排队命令不会被其他客户端提前取走", () => {
  const broker = createBroker();
  const desktop = createStream();
  const phone = createStream();
  try {
    const delivery = broker.publish(
      "user-4",
      "hub-command",
      { type: "synchronize-local-hub", nodeId: "android-4" },
      { queueWhenOffline: true, clientId: "phone-client" }
    );
    assert.deepEqual(delivery, { delivered: 0, queued: true });
    broker.subscribe({ ...desktop, userId: "user-4", clientId: "desktop-client" });
    assert.doesNotMatch(desktop.response.output, /synchronize-local-hub/);
    broker.subscribe({ ...phone, userId: "user-4", clientId: "phone-client" });
    assert.match(phone.response.output, /synchronize-local-hub/);
  } finally {
    broker.close();
  }
});

test("控制订阅只接收命令并从最新游标开始，不推送业务变更", () => {
  let listCalls = 0;
  const broker = new SyncEventBroker({
    latestSequence: () => 27,
    listChanges: () => {
      listCalls += 1;
      return [{ seq: 28, entity_type: "messages", entity_id: "message-1", operation: "upsert", created_at: 1 }];
    }
  });
  const phone = createStream();
  try {
    broker.subscribe({
      ...phone,
      userId: "user-5",
      clientId: "phone-client",
      controlOnly: true
    });
    broker.poll();
    const delivery = broker.publish(
      "user-5",
      "hub-command",
      { type: "switch-desktop-hub", nodeId: "android-5" },
      { clientId: "phone-client" }
    );

    assert.match(phone.response.output, /"cursor":27/);
    assert.doesNotMatch(phone.response.output, /event: change/);
    assert.match(phone.response.output, /switch-desktop-hub/);
    assert.equal(listCalls, 0);
    assert.deepEqual(delivery, { delivered: 1, queued: false });
  } finally {
    broker.close();
  }
});

test("流式通道被代理缓冲时，控制命令仍可由轮询取走且只消费一次", () => {
  const broker = createBroker();
  const phone = createStream();
  try {
    broker.subscribe({ ...phone, userId: "user-6", clientId: "phone-client" });
    const command = {
      commandId: "command-6",
      type: "switch-desktop-hub",
      nodeId: "android-6"
    };
    const delivery = broker.publish("user-6", "hub-command", command, {
      clientId: "phone-client",
      alwaysQueue: true
    });

    assert.deepEqual(delivery, { delivered: 1, queued: true });
    assert.deepEqual(broker.consumePending("user-6", "phone-client"), [command]);
    assert.deepEqual(broker.consumePending("user-6", "phone-client"), []);
  } finally {
    broker.close();
  }
});
