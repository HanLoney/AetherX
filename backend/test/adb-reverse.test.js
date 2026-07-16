const test = require("node:test");
const assert = require("node:assert/strict");
const {
  ensureAdbReverse,
  parseConnectedDevices,
  resolvePort
} = require("../scripts/ensure-adb-reverse");

test("adb 设备列表只接受已经授权且在线的设备", () => {
  assert.deepEqual(
    parseConnectedDevices(
      "List of devices attached\nphone-1\tdevice\nphone-2\tunauthorized\nemulator-5554\toffline\n"
    ),
    ["phone-1"]
  );
});

test("自动为每台在线设备建立与后端端口一致的 reverse", () => {
  const calls = [];
  const logs = [];
  const result = ensureAdbReverse({
    env: { ADB_PATH: "C:\\sdk\\adb.exe", AETHERX_PORT: "5000" },
    platform: "win32",
    existsSync: () => true,
    spawnSync(command, args) {
      calls.push([command, args]);
      if (args[0] === "devices") {
        return { status: 0, stdout: "List of devices attached\na\tdevice\nb\tdevice\n", stderr: "" };
      }
      return { status: 0, stdout: "5000\n", stderr: "" };
    },
    log: (message) => logs.push(message),
    warn: () => {}
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.devices, ["a", "b"]);
  assert.deepEqual(calls.slice(1).map(([, args]) => args), [
    ["-s", "a", "reverse", "tcp:5000", "tcp:5000"],
    ["-s", "b", "reverse", "tcp:5000", "tcp:5000"]
  ]);
  assert.match(logs.at(-1), /2 台 Android 设备/);
});

test("没有手机或关闭自动映射时不会阻止后端启动", () => {
  const noDevice = ensureAdbReverse({
    env: { ADB_PATH: "adb" },
    existsSync: () => true,
    spawnSync: () => ({ status: 0, stdout: "List of devices attached\n", stderr: "" }),
    log: () => {},
    warn: () => {}
  });
  const disabled = ensureAdbReverse({
    env: { AETHERX_ADB_REVERSE: "0" },
    spawnSync: () => {
      throw new Error("不应调用 adb");
    }
  });

  assert.equal(noDevice.status, "no-device");
  assert.equal(disabled.status, "disabled");
  assert.equal(resolvePort("invalid"), 4318);
});
