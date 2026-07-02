const SYSTEM_FEATURE_PATTERN =
  /(系统|功能|工具|模块|界面|页面|UI|待办|记忆中心|自动提取|长期记忆|时间感知|时钟|报时)/i;
const SYSTEM_ISSUE_PATTERN =
  /(应该|不应该|需要|不要|希望|为什么|改成|修复|问题|失效|故障|异常|错误|不生效|不好用|bug)/i;

function isQuestion(value) {
  const text = String(value || "").trim();
  return (
    /[?？]/.test(text) ||
    /(为什么|怎么|如何|是否|难道|请问)/.test(text) ||
    /(吗|呢)[啊呀嘛吧]?[。！!…]*$/.test(text)
  );
}

function isSystemFeedback(value) {
  const text = String(value || "");
  return SYSTEM_FEATURE_PATTERN.test(text) && SYSTEM_ISSUE_PATTERN.test(text);
}

function isInvalidMemorySource(value) {
  return isQuestion(value) || isSystemFeedback(value);
}

module.exports = {
  isInvalidMemorySource,
  isQuestion,
  isSystemFeedback
};
