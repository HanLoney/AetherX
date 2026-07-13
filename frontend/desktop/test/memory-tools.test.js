const test = require("node:test");
const assert = require("node:assert/strict");
const { registerMemoryTools } = require("../memory-tools");

function makeRegistry() {
  const tools = new Map();
  return {
    tools,
    register(tool) {
      tools.set(tool.name, tool);
      return this;
    }
  };
}

test("shared memory list accepts all and omits the backend status filter", async () => {
  let receivedFilters;
  global.desktop = {
    listSharedMemories: async (filters) => {
      receivedFilters = filters;
      return [];
    }
  };
  const registry = makeRegistry();
  registerMemoryTools(registry);
  const tool = registry.tools.get("shared_memory.list");

  assert.deepEqual(tool.inputSchema.properties.status.enum, ["all", "active", "candidate"]);
  const result = await tool.execute({ status: "all" });
  assert.equal(result.ok, true);
  assert.deepEqual(receivedFilters, {});
});

test("personality event list treats all the same way", async () => {
  let receivedFilters;
  global.desktop = {
    listPersonalityEvents: async (filters) => {
      receivedFilters = filters;
      return [];
    }
  };
  const registry = makeRegistry();
  registerMemoryTools(registry);
  const result = await registry.tools.get("personality_event.list").execute({ status: "all" });

  assert.equal(result.ok, true);
  assert.deepEqual(receivedFilters, {});
});
