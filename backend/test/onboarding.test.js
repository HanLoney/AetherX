const assert = require("node:assert/strict");
const test = require("node:test");
const { OnboardingService } = require("../src/modules/onboarding/onboarding-service");

function createPreferences(initial = null) {
  let stored = initial;
  return {
    list() {
      return stored ? [{ key: "first-run-v1", value: stored }] : [];
    },
    saveWithRequestId(_userId, input) {
      stored = input.value;
      return { status: 200, result: { value: stored } };
    }
  };
}

test("new accounts start with AI setup and keep progress recoverable", () => {
  const service = new OnboardingService(createPreferences(), {
    getPublic: () => ({ hasApiKey: false, updatedAt: null })
  });
  assert.equal(service.get("user-1").currentStep, "ai");
  const saved = service.saveWithRequestId("user-1", {
    currentStep: "persona",
    assistantChoice: "custom",
    chatProviderConfigured: true
  }, "request-1").result;
  assert.equal(saved.currentStep, "persona");
  assert.equal(saved.assistantChoice, "custom");
  assert.equal(saved.chatProviderConfigured, true);
});

test("completion requires both a tested provider and assistant profile", () => {
  let providerVerified = false;
  const service = new OnboardingService(createPreferences(), {
    getPublic: () => ({
      hasApiKey: providerVerified,
      verificationStatus: providerVerified ? "verified" : "untested",
      updatedAt: providerVerified ? 150 : null
    })
  });
  const incomplete = service.saveWithRequestId("user-1", {
    currentStep: "complete",
    assistantConfigured: true,
    userGreetingConfigured: true,
    completedAt: 100
  }, "request-1").result;
  assert.equal(incomplete.completedAt, null);
  providerVerified = true;
  const completed = service.saveWithRequestId("user-1", {
    currentStep: "complete",
    assistantConfigured: true,
    userGreetingConfigured: true,
    completedAt: 200
  }, "request-2").result;
  assert.equal(completed.completedAt, 200);
});

test("existing configured accounts are not interrupted by the new onboarding gate", () => {
  const service = new OnboardingService(createPreferences(), {
    getPublic: () => ({ hasApiKey: true, updatedAt: 345 })
  });
  const state = service.get("user-1");
  assert.equal(state.completedAt, 345);
  assert.equal(state.chatProviderConfigured, true);
  assert.equal(state.assistantConfigured, true);
});

test("provider setup cannot complete an interrupted first run, even across service restarts", () => {
  const preferences = createPreferences();
  let provider = { hasApiKey: false };
  const repository = { getPublic: () => provider };
  const service = new OnboardingService(preferences, repository);
  assert.equal(service.get("new").completedAt, null);
  provider = { hasApiKey: true, verificationStatus: "verified", updatedAt: 123 };
  assert.equal(new OnboardingService(preferences, repository).get("new").completedAt, null);
  const progress = service.saveWithRequestId("new", {
    chatProviderConfigured: true, currentStep: "assistant"
  }, "ai-done").result;
  assert.equal(progress.completedAt, null);
  assert.equal(progress.assistantConfigured, false);
  assert.equal(progress.userGreetingConfigured, false);
  assert.deepEqual(new OnboardingService(preferences, repository).get("new"), progress);
  const direct = new OnboardingService(createPreferences(), repository).saveWithRequestId("new", {
    chatProviderConfigured: true, currentStep: "assistant"
  }, "without-get").result;
  assert.equal(direct.completedAt, null);
  assert.equal(direct.assistantConfigured, false);
});

test("false legacy completion is repaired and persisted at each unfinished step", () => {
  for (const step of ["assistant", "persona", "user", "image"]) {
    const preferences = createPreferences({
      version: 1, currentStep: step, assistantChoice: "custom", assistantTemplate: "",
      assistantConfigured: true, userGreetingConfigured: true,
      chatProviderConfigured: true, imageProviderConfigured: false, completedAt: 123
    });
    const service = new OnboardingService(preferences, { getPublic: () => { throw new Error("Do not alter provider"); } });
    const state = service.get("affected");
    assert.equal(state.currentStep, step);
    assert.equal(state.completedAt, null);
    assert.equal(state.assistantConfigured, ["user", "image"].includes(step));
    assert.equal(state.userGreetingConfigured, step === "image");
    assert.equal(state.chatProviderConfigured, true);
    assert.deepEqual(preferences.list()[0].value, state);
  }
});

test("completion requires greeting confirmation and explicit final confirmation", () => {
  const preferences = createPreferences();
  const service = new OnboardingService(preferences, {
    getPublic: () => ({ hasApiKey: true, verificationStatus: "verified", updatedAt: 100 })
  });
  let state = service.saveWithRequestId("new", {
    currentStep: "complete", assistantChoice: "custom", assistantConfigured: true, completedAt: 200
  }, "premature").result;
  assert.equal(state.completedAt, null);
  assert.equal(state.currentStep, "user");
  state = service.saveWithRequestId("new", {
    currentStep: "image", userGreetingConfigured: true
  }, "greeting").result;
  assert.equal(state.completedAt, null);
  state = service.saveWithRequestId("new", { currentStep: "complete" }, "prepare").result;
  assert.equal(state.currentStep, "image");
  assert.equal(state.completedAt, null);
  state = service.saveWithRequestId("new", { currentStep: "complete", completedAt: 300 }, "finish").result;
  assert.equal(state.completedAt, 300);
  assert.equal(service.get("new").currentStep, "complete");
});
