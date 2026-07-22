(function initializeInterfaceSettings(global) {
  const STORAGE_KEY = "aetherx.interface.font-scale";
  const DEFAULT_FONT_SCALE = 100;
  const MIN_FONT_SCALE = 85;
  const MAX_FONT_SCALE = 125;

  function normalizeFontScale(value) {
    if (value === null || value === undefined || value === "") return DEFAULT_FONT_SCALE;
    const number = Number(value);
    if (!Number.isFinite(number)) return DEFAULT_FONT_SCALE;
    return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, Math.round(number / 5) * 5));
  }

  function readFontScale() {
    try {
      return normalizeFontScale(global.localStorage.getItem(STORAGE_KEY));
    } catch {
      return DEFAULT_FONT_SCALE;
    }
  }

  function applyFontScale(value, options = {}) {
    const normalized = normalizeFontScale(value);
    document.documentElement.style.setProperty("--font-scale", String(normalized / 100));
    document.documentElement.dataset.fontScale = String(normalized);
    if (options.persist !== false) {
      try { global.localStorage.setItem(STORAGE_KEY, String(normalized)); } catch { /* 当前会话仍然生效 */ }
    }
    global.dispatchEvent(new CustomEvent("aether:font-scale-changed", { detail: { value: normalized } }));
    return normalized;
  }

  global.AetherInterfaceSettings = Object.freeze({
    defaultFontScale: DEFAULT_FONT_SCALE,
    minFontScale: MIN_FONT_SCALE,
    maxFontScale: MAX_FONT_SCALE,
    normalizeFontScale,
    readFontScale,
    applyFontScale
  });

  global.addEventListener("storage", (event) => {
    if (event.key === STORAGE_KEY) applyFontScale(event.newValue, { persist: false });
  });
  global.addEventListener("message", (event) => {
    if (event.data?.type === "aether:font-scale") applyFontScale(event.data.value);
  });

  applyFontScale(readFontScale(), { persist: false });
})(window);
