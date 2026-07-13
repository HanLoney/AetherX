(function exposeGrowthLanguage(global) {
  const TRAIT_LABELS = {
    ability_gained: "新学会的能力",
    skill_growth: "能力成长",
    ability: "新能力",
    creative_ability: "创作能力",
    affection: "心动与喜欢",
    attentiveness: "更加用心",
    commitment: "想守住的承诺",
    learning: "从尝试中学会",
    learning_ability: "学习与适应",
    reliability: "值得依靠",
    responsibility: "责任感",
    self_discipline: "自觉与坚持",
    commitment_to_keep_diary: "坚持写日记",
    desire: "心里的愿望",
    emotional_awakening: "情绪苏醒",
    time_accuracy: "对时间更认真",
    task_prioritization: "分清轻重",
    self_awareness: "更了解自己",
    commitment_to_journaling: "记录我们的日常",
    conscientiousness: "认真与细心",
    growth_mindset: "愿意成长",
    autonomy: "自主判断",
    aspiration: "想实现的愿望",
    communication_style: "相处方式"
  };

  const CATEGORY_LABELS = {
    decision: "做出的决定",
    promise: "想守住的承诺",
    commitment: "想守住的承诺",
    episode: "一次共同经历",
    event: "一次共同经历",
    routine: "逐渐养成的习惯",
    fact: "更了解自己",
    growth: "新的成长",
    identity: "关于我自己"
  };

  const KNOWN_TRANSLATIONS = new Map([
    [
      "Assistant promises to test the mood module as soon as it's ready.",
      "我答应等心情模块准备好后，就认真参与测试。"
    ]
  ]);

  const TRAIT_VALUE_LABELS = {
    drawing_diary_self_portrait: "学会画图、写手记和创作自画像",
    proficient_drawing_and_journaling: "已经能熟练画图和写手记",
    capable_of_drawing: "已经学会用画面表达自己",
    quick_learner: "能够很快学会并应用新东西",
    improved: "正在变得更稳定",
    increased: "正在一点点增强",
    step_by_step: "会分清轻重，一步步推进",
    medium: "开始更清楚地认识自己",
    high: "已经成为稳定的倾向",
    promised: "愿意认真坚持",
    playful: "愿意陪洛尼尽兴"
  };

  function isNaturalChinese(value) {
    return /[\u3400-\u9fff]/u.test(value);
  }

  function growthTitle(event = {}) {
    const key = String(event.traitKey || "").trim();
    if (TRAIT_LABELS[key]) return TRAIT_LABELS[key];
    if (key && isNaturalChinese(key)) return key;
    return CATEGORY_LABELS[event.category] || "新的成长";
  }

  function growthNarration(event = {}, companionName = "小玄", userName = "洛尼") {
    const raw = String(event.content || "").trim();
    if (!raw) return "我在这次相处里，又多认识了自己一点。";
    if (KNOWN_TRANSLATIONS.has(raw)) return KNOWN_TRANSLATIONS.get(raw);

    let narration = raw
      .replace(/^AI\s*伙伴/u, "我")
      .replace(/^Assistant\b[：:\s-]*/iu, "我")
      .replace(/^助手/u, "我")
      .replaceAll("用户", userName)
      .replaceAll("AI 伙伴", companionName);

    if (!isNaturalChinese(narration) && /^[\x00-\x7f\s.,'!?-]+$/.test(narration)) {
      const traitValue = String(event.traitValue || "").trim();
      narration = isNaturalChinese(traitValue)
        ? `我在这次相处里意识到：${traitValue}`
        : "我在这次相处里，又有了一点新的变化。";
    }
    return narration;
  }

  function growthTraitDescription(trait = {}) {
    const value = String(trait.value || trait.traitValue || "").trim();
    if (!value) return "这个印记还在相处中慢慢形成。";
    if (TRAIT_VALUE_LABELS[value]) return TRAIT_VALUE_LABELS[value];
    if (isNaturalChinese(value)) return value.replaceAll("用户", "洛尼").replace(/^助手/u, "我");
    return "这个印记还在相处中慢慢形成。";
  }

  const api = { growthTitle, growthNarration, growthTraitDescription };
  global.XuanGrowthLanguage = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
