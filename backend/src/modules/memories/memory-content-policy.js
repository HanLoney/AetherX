const SYSTEM_FEATURE_PATTERN =
  /(系统|功能|工具|模块|界面|页面|UI|待办|记忆中心|自动提取|长期记忆|时间感知|时钟|报时)/i;
const SYSTEM_ISSUE_PATTERN =
  /(应该|不应该|需要|不要|希望|为什么|改成|修复|问题|失效|故障|异常|错误|不生效|不好用|bug)/i;
const LOW_VALUE_CONVERSATION_PATTERN =
  /(对不起|抱歉|我错了|弄丢了|没记住|记住了|知道了|明白了|给你找到了|找到了记录|再说一遍|重新说|拿小本本|帮你捋|帮你找)/i;
const SHARED_EVENT_PATTERN =
  /(一起|共同|我们).*(完成|实现|上线|决定|约定|庆祝|经历|创作|设计|调整|解决|做完|去了|见证)/i;

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

function isLowValueConversation(value) {
  return LOW_VALUE_CONVERSATION_PATTERN.test(String(value || ""));
}

function isSharedExperience(value) {
  const text = String(value || "");
  return SHARED_EVENT_PATTERN.test(text) && !isLowValueConversation(text);
}

module.exports = {
  isInvalidMemorySource,
  isLowValueConversation,
  isQuestion,
  isSharedExperience,
  isSystemFeedback
};
