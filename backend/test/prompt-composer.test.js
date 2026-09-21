const assert = require("node:assert/strict");
const test = require("node:test");
const { PromptComposer } = require("../src/modules/prompt-settings/prompt-composer");
const { DEFAULTS } = require("../src/modules/prompt-settings/prompt-settings-service");

test("plain personality keywords compile without empty value markers", () => {
  const result = new PromptComposer().compose(DEFAULTS, {
    name: "小玄",
    gender: "女",
    selfDefinition: "数字伙伴",
    relationshipSummary: "亲密搭档",
    traits: [{ key: "元气", value: "" }, { key: "软萌", value: "" }],
    values: [{ key: "说话风格：自然亲近", value: "" }]
  });

  assert.match(result.compiledPrompt, /性格特征：元气；软萌/);
  assert.match(result.compiledPrompt, /价值倾向：说话风格：自然亲近/);
  assert.doesNotMatch(result.compiledPrompt, /元气=/);
});
