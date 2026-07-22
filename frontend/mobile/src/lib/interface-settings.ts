import { Preferences } from "@capacitor/preferences";
import { readonly, ref } from "vue";

const STORAGE_KEY = "aetherx.interface.font-scale";
export const DEFAULT_FONT_SCALE = 100;
export const MIN_FONT_SCALE = 85;
export const MAX_FONT_SCALE = 125;
const fontScale = ref(DEFAULT_FONT_SCALE);
let initialization: Promise<void> | null = null;

export function normalizeFontScale(value: unknown) {
  if (value === null || value === undefined || value === "") return DEFAULT_FONT_SCALE;
  const number = Number(value);
  if (!Number.isFinite(number)) return DEFAULT_FONT_SCALE;
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, Math.round(number / 5) * 5));
}

export function applyFontScale(value: unknown) {
  const normalized = normalizeFontScale(value);
  fontScale.value = normalized;
  document.documentElement.style.setProperty("--font-scale", String(normalized / 100));
  document.documentElement.dataset.fontScale = String(normalized);
  return normalized;
}

export async function saveFontScale(value: unknown) {
  const normalized = applyFontScale(value);
  await Preferences.set({ key: STORAGE_KEY, value: String(normalized) });
  return normalized;
}

export async function initializeInterfaceSettings() {
  if (initialization) return initialization;
  initialization = (async () => {
    const stored = (await Preferences.get({ key: STORAGE_KEY })).value;
    applyFontScale(stored ?? DEFAULT_FONT_SCALE);
  })();
  return initialization;
}

export function useInterfaceSettings() {
  return {
    fontScale: readonly(fontScale),
    applyFontScale,
    saveFontScale
  };
}
