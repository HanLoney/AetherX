const { randomUUID } = require("node:crypto");
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

  storedItem(userId) {
    return this.preferenceService
      .list(userId, { category: ONBOARDING_CATEGORY })
      .find((preference) => preference.key === ONBOARDING_KEY);
  }

  get(userId) {
    const item = this.storedItem(userId);
    if (item) {
      const state = normalizeState(item.value);
      // Persist repairs so an interrupted v1 flow cannot regain its false completion.
      if (JSON.stringify(state) !== JSON.stringify(item.value)) {
        return this.persist(userId, state, randomUUID()).result;
      }
      return state;
    }
    const config = this.aiConfigRepository?.getPublic(userId);
    let initial = { ...DEFAULT_STATE };
    if (
      config?.hasApiKey &&
      config.updatedAt &&
      config.verificationStatus !== "failed"
    ) {
      initial = {
        ...DEFAULT_STATE,
        currentStep: "complete",
        assistantChoice: "default",
        assistantConfigured: true,
        userGreetingConfigured: true,
        chatProviderConfigured: true,
        completedAt: config.updatedAt
      };
    }
    // Record the initial decision before provider setup can change the legacy check.
    return this.persist(userId, initial, randomUUID()).result;
  }

  saveWithRequestId(userId, input, requestId) {
    // Progress writes must never infer completion from an existing provider.
    const item = this.storedItem(userId);
    const current = item ? normalizeState(item.value) : { ...DEFAULT_STATE };
    const changes = { ...current, ...input };
    if (input.completedAt !== undefined && input.completedAt !== null) {
      const provider = this.aiConfigRepository?.getPublic(userId);
      changes.chatProviderConfigured = Boolean(
        provider?.hasApiKey && provider?.verificationStatus === "verified"
      );
    }
    return this.persist(userId, normalizeState(changes), requestId);
  }

  persist(userId, next, requestId) {
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
  const state = {
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
  if (state.completedAt && state.currentStep !== "complete") {
    state.completedAt = null;
    // These flags were also inherited from the old provider-only completion heuristic.
    if (["ai", "assistant", "persona"].includes(state.currentStep)) state.assistantConfigured = false;
    if (["ai", "assistant", "persona", "user"].includes(state.currentStep)) state.userGreetingConfigured = false;
  }
  if (state.currentStep === "complete" && (!state.completedAt
    || !state.chatProviderConfigured || !state.assistantConfigured || !state.userGreetingConfigured)) {
    state.completedAt = null;
    state.currentStep = !state.chatProviderConfigured ? "ai"
      : !state.assistantConfigured ? (state.assistantChoice ? "persona" : "assistant")
        : !state.userGreetingConfigured ? "user" : "image";
  }
  return state;
}

module.exports = { DEFAULT_STATE, OnboardingService, normalizeState };
