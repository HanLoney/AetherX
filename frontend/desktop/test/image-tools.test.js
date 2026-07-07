const test = require("node:test");
const assert = require("node:assert/strict");
const { registerImageTools } = require("../image-tools");
const illustrator = require("../journal-illustrator");

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

function baseOptions(overrides = {}) {
  return {
    illustrator,
    generateImage: async () => ({ ok: true, images: [{ b64Json: "IMG" }] }),
    getPersonaImage: () => "",
    isImageEnabled: () => true,
    ...overrides
  };
}

test("registers image.generate as a write tool", () => {
  const registry = makeRegistry();
  registerImageTools(registry, baseOptions());
  const tool = registry.tools.get("image.generate");
  assert.ok(tool);
  assert.equal(tool.risk, "write");
  assert.deepEqual(tool.inputSchema.required, ["description"]);
});

test("generates an anime image and returns the source separately from model text", async () => {
  const payloads = [];
  const registry = makeRegistry();
  registerImageTools(
    registry,
    baseOptions({
      generateImage: async (payload) => {
        payloads.push(payload);
        return { ok: true, images: [{ b64Json: "AAAABBBB" }] };
      }
    })
  );

  const result = await registry.tools
    .get("image.generate")
    .execute({ description: "黄昏的天空", selfie: false });

  assert.equal(result.ok, true);
  assert.match(payloads[0].prompt, /二次元/);
  assert.equal(payloads[0].image, undefined);
  assert.match(result.content, /黄昏的天空/);
  assert.equal(result.data.selfie, false);
  assert.equal(result.image, "data:image/png;base64,AAAABBBB");
});

test("passes the persona image only for selfies", async () => {
  const selfiePayloads = [];
  const registry = makeRegistry();
  registerImageTools(
    registry,
    baseOptions({
      getPersonaImage: () => "data:image/png;base64,PERSONA",
      generateImage: async (payload) => {
        selfiePayloads.push(payload);
        return { ok: true, images: [{ b64Json: "IMG" }] };
      }
    })
  );

  const selfie = await registry.tools
    .get("image.generate")
    .execute({ description: "书桌旁的我", selfie: true });
  assert.match(selfie.content, /自拍/);
  assert.deepEqual(selfiePayloads[0].image, ["data:image/png;base64,PERSONA"]);
  assert.match(selfiePayloads[0].prompt, /人设图/);

  const scene = await registry.tools
    .get("image.generate")
    .execute({ description: "窗外的猫", selfie: false });
  assert.equal(selfiePayloads[1].image, undefined);
  assert.doesNotMatch(scene.content, /自拍/);
});

test("fails cleanly when generation is disabled", async () => {
  const registry = makeRegistry();
  registerImageTools(registry, baseOptions({ isImageEnabled: () => false }));
  const result = await registry.tools
    .get("image.generate")
    .execute({ description: "海边" });
  assert.equal(result.ok, false);
  assert.match(result.content, /API Key/);
});

test("fails when the description is empty", async () => {
  const registry = makeRegistry();
  registerImageTools(registry, baseOptions());
  const result = await registry.tools
    .get("image.generate")
    .execute({ description: "   " });
  assert.equal(result.ok, false);
  assert.match(result.content, /描述/);
});

test("surfaces the upstream error when generation fails", async () => {
  const registry = makeRegistry();
  registerImageTools(
    registry,
    baseOptions({
      generateImage: async () => ({ ok: false, status: 500 })
    })
  );
  const result = await registry.tools
    .get("image.generate")
    .execute({ description: "失败场景" });
  assert.equal(result.ok, false);
  assert.match(result.content, /500/);
});
