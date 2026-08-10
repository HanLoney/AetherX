const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const bundle = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(bundle)) {
  console.error(`Android bundle was not found: ${bundle}`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32"
  });
  if (result.status !== 0) {
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.status || 1);
  }
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

run("jarsigner", ["-verify", bundle]);
const certificate = run("keytool", ["-printcert", "-jarfile", bundle]);
const expected = fs.readFileSync(
  path.resolve(__dirname, "..", "ANDROID_SIGNING_CERT_SHA256"),
  "utf8"
).trim().toLowerCase();
const fingerprints = certificate.match(/[a-f0-9]{2}(?::[a-f0-9]{2}){31}/ig) || [];
const actual = fingerprints
  .map((value) => value.replaceAll(":", "").toLowerCase())
  .find((value) => value.length === 64);

if (actual !== expected) {
  console.error(`AAB signer mismatch: expected ${expected}, got ${actual || "unknown"}`);
  process.exit(1);
}

console.log(`Android bundle signature verified: ${bundle}`);
