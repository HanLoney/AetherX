import { useDataStore } from "../stores/data";

let startPromise: Promise<void> | null = null;
let started = false;

export function ensureMobileDataStarted() {
  if (started) return Promise.resolve();
  if (!startPromise) {
    const data = useDataStore();
    startPromise = (async () => {
      const restored = await data.restoreCache();
      if (!restored) await data.refreshAll().catch(() => undefined);
      void data.preloadGallery().catch(() => undefined);
      await data.startSync();
      started = true;
    })().finally(() => {
      startPromise = null;
    });
  }
  return startPromise;
}

window.addEventListener("aetherx:session-invalidated", () => { started = false; });
