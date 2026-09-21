const ONBOARDING_CATEGORY = "onboarding";
const ONBOARDING_KEY = "first-run-v1";

const DEFAULT_STATE = Object.freeze({
  version: 1,
  currentStep: "ai",
  assistantChoice: "",
  assistantTemplate: "",
  assistantConfigured: false,
  userGreetingConfigured: false,
  chatProviderConfigured: false,
  imageProviderConfigured: false,
  completedAt: null
});

class OnboardingService {
  constructor(preferenceService, aiConfigRepository) {
    this.preferenceService = preferenceService;
    this.aiConfigRepository = aiConfigRepository;
  }

  get(userId) {
    const item = this.preferenceService
      .list(userId, { category: ONBOARDING_CATEGORY })
      .find((preference) => preference.key === ONBOARDING_KEY);
    if (item) return normalizeState(item.value);
    const config = this.aiConfigRepository?.getPublic(userId);
    if (
      config?.hasApiKey &&
      config.updatedAt &&
      config.verificationStatus !== "failed"
    ) {
      return {
        ...DEFAULT_STATE,
        currentStep: "complete",
        assistantChoice: "default",
        assistantConfigured: true,
        userGreetingConfigured: true,
        chatProviderConfigured: true,
        completedAt: config.updatedAt
      };
    }
    return { ...DEFAULT_STATE };
  }

  saveWithRequestId(userId, input, requestId) {
    const current = this.get(userId);
    const next = normalizeState({ ...current, ...input });
    if (input.completedAt !== undefined && input.completedAt !== null) {
      const provider = this.aiConfigRepository?.getPublic(userId);
      next.chatProviderConfigured = Boolean(
        provider?.hasApiKey && provider?.verificationStatus === "verified"
      );
    }
    if (next.completedAt && !(next.chatProviderConfigured && next.assistantConfigured)) {
      next.completedAt = null;
    }
    const result = this.preferenceService.saveWithRequestId(
      userId,
      {
        category: ONBOARDING_CATEGORY,
        key: ONBOARDING_KEY,
        value: next,
        source: "explicit",
        confidence: 1,
        sensitivity: "normal"
      },
      requestId
    );
    return { status: result.status, result: normalizeState(result.result.value) };
  }
}

function normalizeState(value = {}) {
  const choice = ["default", "template", "custom"].includes(value.assistantChoice)
    ? value.assistantChoice
    : "";
  return {
    version: 1,
    currentStep: ["ai", "assistant", "persona", "user", "image", "complete"].includes(value.currentStep)
      ? value.currentStep
      : "ai",
    assistantChoice: choice,
    assistantTemplate: String(value.assistantTemplate || "").slice(0, 40),
    assistantConfigured: value.assistantConfigured === true,
    userGreetingConfigured: value.userGreetingConfigured === true,
    chatProviderConfigured: value.chatProviderConfigured === true,
    imageProviderConfigured: value.imageProviderConfigured === true,
    completedAt: Number.isFinite(Number(value.completedAt)) && Number(value.completedAt) > 0
      ? Number(value.completedAt)
      : null
  };
}

module.exports = { DEFAULT_STATE, OnboardingService, normalizeState };
