const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { ComponentManager } = require("../frontend/launcher/component-manager");

const root = path.resolve(__dirname, "..");
const oldArchive = path.resolve(process.argv[2] || "");
const oldVersion = String(process.argv[3] || "").trim();
const currentPayload = path.join(root, "frontend", "desktop", "dist", "win-unpacked");

if (!oldArchive || !fs.existsSync(oldArchive) || !/^\d+\.\d+\.\d+$/.test(oldVersion)) {
  throw new Error("Usage: node scripts/smoke-windows-upgrade.js <old-installer.exe> <old-version>");
}
if (!fs.existsSync(path.join(currentPayload, "AetherX.exe"))) {
  throw new Error("Current desktop payload is missing; run the desktop directory build first.");
}

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "aetherx-upgrade-smoke-"));
const previousLocalAppData = process.env.LOCALAPPDATA;

function find7zip() {
  const explicit = process.env.AETHERX_7ZA;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const cache = path.join(process.env.LOCALAPPDATA || "", "electron-builder", "Cache");
  const pending = fs.existsSync(cache) ? [cache] : [];
  while (pending.length) {
    const directory = pending.pop();
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (/^7za?\.exe$/i.test(entry.name)) return target;
    }
  }
  throw new Error("7-Zip executable was not found in the electron-builder cache.");
}

function createManager(resourcesPath) {
  const appData = path.join(tempRoot, "roaming");
  const userData = path.join(tempRoot, "state");
  const manager = new ComponentManager({
    app: {
      getPath(name) {
        if (name === "appData") return appData;
        if (name === "userData") return userData;
        throw new Error(`Unexpected app path: ${name}`);
      }
    },
    resourcesPath,
    isPackaged: true,
    tailscaleManager: { getStatus: async () => ({ remote: { status: "off" }, tailscale: null }) }
  });
  manager.getDesktopControl = async () => null;
  manager.getStatus = async () => ({});
  return manager;
}

async function main() {
  const sevenZip = find7zip();
  process.env.LOCALAPPDATA = path.join(tempRoot, "local");
  const oldResources = path.join(tempRoot, "old-resources");
  const oldPayload = path.join(oldResources, "payload", "desktop");
  fs.mkdirSync(oldPayload, { recursive: true });
  const extraction = spawnSync(sevenZip, ["x", oldArchive, `-o${oldPayload}`, "-y"], {
    stdio: "inherit",
    windowsHide: true
  });
  if (extraction.status !== 0) throw new Error("Failed to extract the previous desktop installer.");

  const oldExecutable = fs.readdirSync(oldPayload)
    .find((name) => name.toLowerCase().endsWith(".exe") && name.toLowerCase() !== "aetherx.exe");
  if (!oldExecutable && !fs.existsSync(path.join(oldPayload, "AetherX.exe"))) {
    throw new Error("Previous desktop executable was not found in the installer.");
  }
  if (oldExecutable) {
    fs.renameSync(path.join(oldPayload, oldExecutable), path.join(oldPayload, "AetherX.exe"));
  }
  fs.writeFileSync(
    path.join(oldPayload, ".aetherx-payload.json"),
    `${JSON.stringify({ name: "AetherX Desktop", version: oldVersion }, null, 2)}\n`
  );

  const oldManager = createManager(oldResources);
  const hubSentinel = path.join(tempRoot, "roaming", "AetherX", "hub", "upgrade-sentinel.txt");
  fs.mkdirSync(path.dirname(hubSentinel), { recursive: true });
  fs.writeFileSync(hubSentinel, "preserve-me\n");
  await oldManager.installDesktop();

  const marker = oldManager.paths.desktopMarker;
  const installedOld = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (installedOld.version !== oldVersion) throw new Error("Previous version marker was not installed.");

  const currentResources = path.join(tempRoot, "current-resources");
  const currentResourcesPayload = path.join(currentResources, "payload", "desktop");
  fs.mkdirSync(path.dirname(currentResourcesPayload), { recursive: true });
  fs.cpSync(currentPayload, currentResourcesPayload, { recursive: true });
  const expectedVersion = fs.readFileSync(path.join(root, "VERSION"), "utf8").trim();
  fs.writeFileSync(
    path.join(currentResourcesPayload, ".aetherx-payload.json"),
    `${JSON.stringify({ name: "AetherX Desktop", version: expectedVersion }, null, 2)}\n`
  );
  const currentManager = createManager(currentResources);
  await currentManager.installDesktop();

  const installedCurrent = JSON.parse(fs.readFileSync(marker, "utf8"));
  if (installedCurrent.version !== expectedVersion) throw new Error("Current version marker was not installed.");
  if (!fs.existsSync(path.join(currentManager.paths.desktopInstall, "AetherX.exe"))) {
    throw new Error("Current desktop executable is missing after upgrade.");
  }
  if (fs.readFileSync(hubSentinel, "utf8") !== "preserve-me\n") {
    throw new Error("Hub data changed during desktop upgrade.");
  }
  if (
    fs.existsSync(`${currentManager.paths.desktopInstall}.previous`) ||
    fs.existsSync(`${currentManager.paths.desktopInstall}.staging`)
  ) {
    throw new Error("Upgrade staging or rollback directories were not cleaned.");
  }
  console.log(`Windows isolated upgrade smoke passed: ${oldVersion} -> ${expectedVersion}`);
}

main().finally(() => {
  if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = previousLocalAppData;
  fs.rmSync(tempRoot, { recursive: true, force: true });
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
