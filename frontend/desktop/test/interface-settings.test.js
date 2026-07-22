const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

function createRuntime(storedValue = null) {
  const values = new Map(storedValue === null ? [] : [["aetherx.interface.font-scale", storedValue]]);
  const properties = new Map();
  const listeners = new Map();
  const window = {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value)
    },
    addEventListener(type, callback) { listeners.set(type, callback); },
    dispatchEvent() {}
  };
  const document = {
    documentElement: {
      dataset: {},
      style: { setProperty: (key, value) => properties.set(key, value) }
    }
  };
  const source = fs.readFileSync(path.join(__dirname, "..", "interface-settings.js"), "utf8");
  vm.runInNewContext(source, { window, document, CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } } });
  return { window, properties, values, listeners };
}

test("interface font scale is normalized, applied and persisted", () => {
  const runtime = createRuntime("113");
  assert.equal(runtime.properties.get("--font-scale"), "1.15");
  assert.equal(runtime.window.AetherInterfaceSettings.applyFontScale(124), 125);
  assert.equal(runtime.properties.get("--font-scale"), "1.25");
  assert.equal(runtime.values.get("aetherx.interface.font-scale"), "125");
});

test("an empty first-run value keeps the default font size", () => {
  const runtime = createRuntime();
  assert.equal(runtime.properties.get("--font-scale"), "1");
  assert.equal(runtime.window.AetherInterfaceSettings.readFontScale(), 100);
});

test("every desktop page loads the shared interface settings runtime", () => {
  const desktop = path.join(__dirname, "..");
  const pages = fs.readdirSync(desktop).filter((name) => name.endsWith(".html"));
  pages.forEach((name) => {
    assert.match(fs.readFileSync(path.join(desktop, name), "utf8"), /<script src="interface-settings\.js"><\/script>/, name);
  });
});
