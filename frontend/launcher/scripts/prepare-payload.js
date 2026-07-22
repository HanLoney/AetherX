const fs = require("node:fs");
const path = require("node:path");

const launcherDir = path.resolve(__dirname, "..");
const desktopDir = path.resolve(launcherDir, "..", "desktop");
const desktopPackage = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8"));
const payloadDir = path.join(desktopDir, "dist", "win-unpacked");
const executable = path.join(payloadDir, "AetherX.exe");

if (!fs.existsSync(executable)) {
  throw new Error(`桌面端载荷不存在：${executable}`);
}

fs.writeFileSync(
  path.join(payloadDir, ".aetherx-payload.json"),
  `${JSON.stringify({ name: "AetherX Desktop", version: desktopPackage.version }, null, 2)}\n`,
  "utf8"
);

console.log(`桌面端载荷已准备：AetherX ${desktopPackage.version}`);
