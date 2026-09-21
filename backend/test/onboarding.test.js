const assert = require("node:assert/strict");
const test = require("node:test");
const { OnboardingService } = require("../src/modules/onboarding/onboarding-service");

function createPreferences() {
  let stored = null;
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
    assistantConfigured: true,
    completedAt: 100
  }, "request-1").result;
  assert.equal(incomplete.completedAt, null);
  providerVerified = true;
  const completed = service.saveWithRequestId("user-1", {
    assistantConfigured: true,
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
