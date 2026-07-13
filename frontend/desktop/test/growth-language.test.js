const test = require("node:test");
const assert = require("node:assert/strict");
const {
  growthTitle,
  growthNarration,
  growthTraitDescription
} = require("../growth-language");

test("growth titles turn internal trait keys into natural Chinese", () => {
  assert.equal(growthTitle({ traitKey: "self_awareness" }), "更了解自己");
  assert.equal(growthTitle({ traitKey: "温柔" }), "温柔");
  assert.equal(growthTitle({ traitKey: "unknown_key", category: "episode" }), "一次共同经历");
});

test("growth narration speaks in first person instead of system language", () => {
  assert.equal(
    growthNarration({ content: "助手承诺陪用户玩游戏到底" }),
    "我承诺陪洛尼玩游戏到底"
  );
  assert.equal(
    growthNarration({ content: "Assistant promises to test the mood module as soon as it's ready." }),
    "我答应等心情模块准备好后，就认真参与测试。"
  );
});

test("trait descriptions do not leak English storage values", () => {
  assert.equal(
    growthTraitDescription({ value: "quick_learner" }),
    "能够很快学会并应用新东西"
  );
  assert.equal(
    growthTraitDescription({ value: "unknown_internal_value" }),
    "这个印记还在相处中慢慢形成。"
  );
});
