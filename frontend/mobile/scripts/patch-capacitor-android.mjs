import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const targets = [
  "../node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/Bridge.java",
  "../node_modules/@capacitor/android/capacitor/src/main/java/com/getcapacitor/cordova/MockCordovaWebViewImpl.java"
];
const unsafeCall = "window.Capacitor.triggerEvent(";
const guardedCall = "window.Capacitor?.triggerEvent?.(";

for (const target of targets) {
  const path = fileURLToPath(new URL(target, import.meta.url));
  const source = readFileSync(path, "utf8");
  const patched = source.replaceAll(unsafeCall, guardedCall);
  if (!patched.includes(guardedCall)) {
    throw new Error(`Unsupported Capacitor Android lifecycle bridge: ${path}`);
  }
  if (patched !== source) writeFileSync(path, patched);
}
