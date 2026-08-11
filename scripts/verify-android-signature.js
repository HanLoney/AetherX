const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const apk = path.resolve(process.argv[2] || "");
if (!process.argv[2] || !fs.existsSync(apk)) {
  console.error(`找不到待验证 APK：${apk}`);
  process.exit(1);
}

const sdkCandidates = [
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Android", "Sdk"),
  process.env.HOME && path.join(process.env.HOME, "Android", "Sdk")
].filter(Boolean);
const sdkRoot = sdkCandidates.find((candidate) => fs.existsSync(candidate));
if (!sdkRoot) {
  console.error("ANDROID_HOME 或 ANDROID_SDK_ROOT 未设置，无法运行 apksigner");
  process.exit(1);
}

const buildTools = path.join(sdkRoot, "build-tools");
const versions = fs.readdirSync(buildTools, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort((left, right) => right.localeCompare(left, undefined, { numeric: true }));
const executable = process.platform === "win32" ? "apksigner.bat" : "apksigner";
const signer = versions
  .map((item) => path.join(buildTools, item, executable))
  .find((candidate) => fs.existsSync(candidate));

if (!signer) {
  console.error(`Android SDK 中找不到 ${executable}`);
  process.exit(1);
}

const result = spawnSync(signer, ["verify", "--verbose", "--print-certs", apk], {
  encoding: "utf8",
  shell: process.platform === "win32"
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status !== 0) process.exit(result.status || 1);

const expectedFingerprintPath = path.resolve(__dirname, "..", "ANDROID_SIGNING_CERT_SHA256");
const expectedFingerprint = fs.readFileSync(expectedFingerprintPath, "utf8").trim().toLowerCase();
const actualFingerprint = result.stdout
  .match(/(?:Signer #1|V\d+(?:\.\d+)? Signer):?\s*certificate SHA-256 digest:\s*([a-f0-9]{64})/i)?.[1]
  ?.toLowerCase();
const signerCount = Number(result.stdout.match(/Number of signers:\s*(\d+)/i)?.[1]);
if (signerCount !== 1 || actualFingerprint !== expectedFingerprint) {
  console.error(
    `APK signer mismatch: expected ${expectedFingerprint}, got ${actualFingerprint || "unknown"}`
  );
  process.exit(1);
}
console.log(`APK 签名验证通过：${apk}`);
