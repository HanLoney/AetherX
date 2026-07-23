import { useDataStore } from "../stores/data";

let startPromise: Promise<void> | null = null;

export function ensureMobileDataStarted() {
  if (!startPromise) {
    const data = useDataStore();
    startPromise = (async () => {
      const restored = await data.restoreCache();
      if (!restored) await data.refreshAll().catch(() => undefined);
      void data.preloadGallery().catch(() => undefined);
      await data.startSync();
    })().finally(() => {
      startPromise = null;
    });
  }
  return startPromise;
}
