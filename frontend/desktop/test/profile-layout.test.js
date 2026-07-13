const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const html = fs.readFileSync(path.join(__dirname, "..", "profile.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "profile.css"), "utf8");
const javascript = fs.readFileSync(path.join(__dirname, "..", "profile.js"), "utf8");

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

test("profile navigation is a clickable bottom glass capsule", () => {
  assert.match(css, /\.profile-tabs\s*\{[^}]*position:\s*fixed;/s);
  assert.match(css, /\.profile-tabs\s*\{[^}]*bottom:\s*22px;/s);
  assert.match(css, /\.profile-tabs\s*\{[^}]*border-radius:\s*999px;/s);
  assert.match(css, /\.profile-tabs\s*\{[^}]*backdrop-filter:\s*blur\(24px\)/s);
  assert.match(css, /\.profile-tab\s*\{[^}]*-webkit-app-region:\s*no-drag;/s);
});

test("growth banner is separated from the hero and stays compact", () => {
  assert.match(css, /\.growth-space\s*\{[^}]*margin-top:\s*30px;/s);
  assert.match(css, /\.growth-intro\s*\{[^}]*min-height:\s*218px;/s);
});

test("overview gallery never exposes image generation descriptions as tooltips", () => {
  assert.doesNotMatch(javascript, /button\.title\s*=\s*image\.description/);
  assert.doesNotMatch(javascript, /preview\.alt\s*=\s*image\.description/);
  assert.match(javascript, /button\.title\s*=\s*previewLabel/);
});
