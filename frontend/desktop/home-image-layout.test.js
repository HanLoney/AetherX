const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const css = readFileSync(join(__dirname, "home.css"), "utf8");

test("generated images are not clipped by the generic activity disclosure", () => {
  assert.match(
    css,
    /\.image-activity\.expanded\s*>\s*\.activity-details\s*\{[^}]*max-height:\s*none;[^}]*overflow:\s*visible;/s
  );
});

test("generated images preserve their intrinsic aspect ratio", () => {
  const rule = css.match(/\.image-activity-figure img\s*\{([^}]*)\}/s)?.[1] || "";
  assert.match(rule, /width:\s*auto;/);
  assert.match(rule, /max-width:\s*100%;/);
  assert.match(rule, /height:\s*auto;/);
  assert.match(rule, /object-fit:\s*contain;/);
});
