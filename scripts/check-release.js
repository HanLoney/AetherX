const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const version = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
const failures = [];

const androidSigningFingerprint = fs.readFileSync(
  path.join(root, "ANDROID_SIGNING_CERT_SHA256"),
  "utf8"
).trim();
if (!/^[a-f0-9]{64}$/.test(androidSigningFingerprint)) {
  failures.push("ANDROID_SIGNING_CERT_SHA256 不是有效的 SHA-256 证书指纹");
}

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  failures.push(`VERSION 不是有效的语义化版本：${version}`);
}

for (const relative of [
  "backend/package.json",
  "frontend/desktop/package.json",
  "frontend/mobile/package.json",
  "frontend/launcher/package.json"
]) {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  if (manifest.version !== version) {
    failures.push(`${relative} 的版本 ${manifest.version} 与 VERSION ${version} 不一致`);
  }
}

const desktopManifest = JSON.parse(
  fs.readFileSync(path.join(root, "frontend/desktop/package.json"), "utf8")
);
if (desktopManifest.build?.appId !== "com.xuanxiaotech.todo") {
  failures.push("Windows appId 已改变，会破坏现有安装的升级身份");
}

const gradle = fs.readFileSync(
  path.join(root, "frontend/mobile/android/app/build.gradle"),
  "utf8"
);
if (!gradle.includes('file("../../../../VERSION")')) {
  failures.push("Android versionName 没有从仓库 VERSION 读取");
}
if (!gradle.includes("AETHERX_REQUIRE_SIGNING")) {
  failures.push("Android Release 没有强制签名门禁");
}

const capacitorConfig = fs.readFileSync(
  path.join(root, "frontend/mobile/capacitor.config.ts"),
  "utf8"
);
if (!/allowMixedContent:\s*false/.test(capacitorConfig)) {
  failures.push("公开 Android 配置仍允许混合内容");
}

const mobileHealth = fs.readFileSync(
  path.join(root, "frontend/mobile/src/lib/device-health.ts"),
  "utf8"
);
if (!mobileHealth.includes("__AETHERX_VERSION__")) {
  failures.push("移动端运行时版本没有从统一构建版本读取");
}

const releaseNetworkConfig = fs.readFileSync(
  path.join(root, "frontend/mobile/android/app/src/main/res/xml/network_security_config.xml"),
  "utf8"
);
if (!/base-config cleartextTrafficPermitted="false"/.test(releaseNetworkConfig)) {
  failures.push("Android Release 基础网络策略仍允许明文流量");
}

const lanReleaseNetworkConfig = fs.readFileSync(
  path.join(
    root,
    "frontend/mobile/android/app/src/lanRelease/res/xml/network_security_config.xml"
  ),
  "utf8"
);
if (!/base-config cleartextTrafficPermitted="true"/.test(lanReleaseNetworkConfig)) {
  failures.push("Android lanRelease must explicitly allow private Hub HTTP");
}
if (!gradle.includes("lanRelease {") ||
    !gradle.includes('buildConfigField "boolean", "ALLOW_INSECURE_LAN", "true"')) {
  failures.push("Android lanRelease is missing the private Hub build gate");
}

const changelog = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
if (!changelog.includes(`## [${version}]`)) {
  failures.push(`CHANGELOG.md 缺少 ${version} 发布说明`);
}

if (!fs.existsSync(path.join(root, ".github/workflows/release.yml"))) {
  failures.push("缺少标签发布工作流");
}

if (process.argv.includes("--tag")) {
  const tag = String(process.env.GITHUB_REF_NAME || process.env.AETHERX_RELEASE_TAG || "");
  if (tag !== `v${version}`) failures.push(`发布标签 ${tag || "<empty>"} 必须等于 v${version}`);
}

if (process.argv.includes("--require-clean")) {
  const status = spawnSync("git", ["status", "--porcelain"], {
    cwd: root,
    encoding: "utf8"
  });
  if (status.status !== 0) failures.push("无法读取 Git 工作区状态");
  else if (status.stdout.trim()) failures.push("发布前 Git 工作区必须干净");
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`发布配置检查通过：AetherX ${version}`);
}
