const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "profile.html"), "utf8");

test("AI profile page keeps every id unique", () => {
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test("AI profile tabs have matching content views", () => {
  const tabs = [...html.matchAll(/data-profile-view="([^"]+)"/g)].map(
    (match) => match[1]
  );
  const views = new Set(
    [...html.matchAll(/data-assistant-view="([^"]+)"/g)].map(
      (match) => match[1]
    )
  );

  assert.deepEqual(tabs, ["overview", "journal", "gallery", "growth"]);
  tabs.forEach((tab) => assert.ok(views.has(tab), `missing view for ${tab}`));
});

test("persona editing is isolated inside the settings dialog", () => {
  const modalStart = html.indexOf('id="assistantSettingsModal"');
  const cropModalStart = html.indexOf('id="avatarCropModal"');
  const settingsMarkup = html.slice(modalStart, cropModalStart);

  assert.ok(modalStart > 0);
  assert.match(settingsMarkup, /id="assistantProfileForm"/);
  assert.match(settingsMarkup, /id="personaImageSection"/);
  assert.doesNotMatch(html.slice(0, modalStart), /id="assistantProfileForm"/);
});

test("growth view keeps traits and events in one continuous experience", () => {
  const growthStart = html.indexOf('id="growthSection"');
  const modalStart = html.indexOf('id="assistantSettingsModal"');
  const growthMarkup = html.slice(growthStart, modalStart);

  assert.ok(growthStart > 0);
  assert.match(growthMarkup, /id="growthTraitCount"/);
  assert.match(growthMarkup, /id="growthEventCount"/);
  assert.match(growthMarkup, /id="traitList"/);
  assert.match(growthMarkup, /id="personalityTimeline"/);
  assert.doesNotMatch(html, /id="personalityTimelineSection"/);
});
