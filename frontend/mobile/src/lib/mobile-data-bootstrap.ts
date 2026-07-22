import { useDataStore } from "../stores/data";

let startPromise: Promise<void> | null = null;

export function ensureMobileDataStarted() {
  if (!startPromise) {
    const data = useDataStore();
    startPromise = (async () => {
      if (!data.lastUpdatedAt.value) await data.refreshAll().catch(() => undefined);
      await data.startSync();
    })().finally(() => {
      startPromise = null;
    });
  }
  return startPromise;
}
