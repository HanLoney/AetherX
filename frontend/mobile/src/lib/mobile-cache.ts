import { Preferences } from "@capacitor/preferences";
import type { AetherApi, Conversation, GalleryImage, Journal, Memory, Todo } from "./api";
import { hydrateMediaSources } from "./api";

const CACHE_VERSION = 1;
const DATA_CACHE_PREFIX = "aetherx.mobile.data";

export interface MobileDataSnapshot {
  version: typeof CACHE_VERSION;
  savedAt: number;
  todos: Todo[];
  memories: Memory[];
  conversations: Conversation[];
  profile: Record<string, unknown>;
  assistant: Record<string, unknown>;
  galleryImages: GalleryImage[];
  galleryTotal: number;
  galleryAlbumImages: GalleryImage[];
  galleryAlbumTotal: number;
  journals: Journal[];
}

export function mobileDataCacheKey(scope: string) {
  const normalized = String(scope || "default").trim().toLocaleLowerCase();
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${DATA_CACHE_PREFIX}.${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export async function loadMobileDataCache(scope: string, api: AetherApi) {
  try {
    const raw = (await Preferences.get({ key: mobileDataCacheKey(scope) })).value;
    if (!raw) return null;
    const snapshot = JSON.parse(raw) as MobileDataSnapshot;
    if (snapshot.version !== CACHE_VERSION || !Number.isFinite(snapshot.savedAt)) return null;
    return hydrateMediaSources(snapshot, api.serverUrl, api.accessToken) as MobileDataSnapshot;
  } catch {
    return null;
  }
}

export async function saveMobileDataCache(scope: string, snapshot: MobileDataSnapshot) {
  const safeSnapshot = removeAuthenticatedMediaUrls(snapshot);
  await Preferences.set({
    key: mobileDataCacheKey(scope),
    value: JSON.stringify(safeSnapshot)
  });
}

export async function clearMobileDataCache(scope: string) {
  await Preferences.remove({ key: mobileDataCacheKey(scope) });
}

export function removeAuthenticatedMediaUrls<T>(value: T): T {
  if (Array.isArray(value)) return value.map((item) => removeAuthenticatedMediaUrls(item)) as T;
  if (!value || typeof value !== "object") return value;
  const clone: Record<string, unknown> = {};
  const record = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(record)) {
    if (record.mediaId && (key === "source" || key === "originalSource")) continue;
    clone[key] = removeAuthenticatedMediaUrls(child);
  }
  return clone as T;
}

export function createMobileDataSnapshot(input: Omit<MobileDataSnapshot, "version" | "savedAt">): MobileDataSnapshot {
  return {
    version: CACHE_VERSION,
    savedAt: Date.now(),
    ...input
  };
}

export function warmGalleryPreviews(images: GalleryImage[], eagerCount = 4) {
  const sources = [...new Set(images.map((image) => image.source).filter(Boolean))];
  const warm = (source: string) => new Promise<void>((resolve) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = image.onerror = () => resolve();
    image.src = source;
  });
  const eager = Promise.allSettled(sources.slice(0, eagerCount).map(warm));
  const remaining = () => {
    const queue = sources.slice(eagerCount);
    const worker = async () => {
      while (queue.length) {
        const source = queue.shift();
        if (source) await warm(source);
      }
    };
    void Promise.allSettled(Array.from({ length: Math.min(3, queue.length) }, worker));
  };
  if (sources.length > eagerCount) {
    const idle = window.requestIdleCallback;
    if (typeof idle === "function") idle(remaining, { timeout: 2_000 });
    else window.setTimeout(remaining, 250);
  }
  return eager;
}
