import { spawnSync } from "node:child_process";
import process from "node:process";

const edition = String(process.argv[2] || "local").toLowerCase();
if (!new Set(["local", "cloud"]).has(edition)) {
  throw new Error("Android edition must be local or cloud.");
}

const windows = process.platform === "win32";
const npm = "npm";
const npx = "npx";
const environment = {
  ...process.env,
  AETHERX_MOBILE_EDITION: edition
};

run(process.execPath, ["scripts/patch-capacitor-android.mjs"]);
run(npm, ["run", edition === "cloud" ? "build:cloud" : "build"]);
run(npx, ["cap", "sync", "android"]);

function run(command, args) {
  const useWindowsCommandProcessor = windows && new Set(["npm", "npx"]).has(command);
  const executable = useWindowsCommandProcessor ? (process.env.ComSpec || "cmd.exe") : command;
  const executableArgs = useWindowsCommandProcessor
    ? ["/d", "/s", "/c", command, ...args]
    : args;
  const result = spawnSync(executable, executableArgs, {
    cwd: process.cwd(),
    env: environment,
    stdio: "inherit"
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
