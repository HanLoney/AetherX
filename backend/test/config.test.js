const test = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");

test("registration mode defaults to open", () => {
  assert.equal(loadConfig({}).registrationMode, "open");
});

test("registration mode rejects unsafe typos", () => {
  assert.throws(
    () => loadConfig({ AETHERX_REGISTRATION_MODE: "invte" }),
    /open, invite or closed/
  );
});
