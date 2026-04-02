export type DisplayMode = "light" | "dark" | "system";

const DISPLAY_MODE_KEY = "tama_display_mode";
const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

let systemMediaQuery: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: (event: MediaQueryListEvent) => void) => void;
  removeListener?: (listener: (event: MediaQueryListEvent) => void) => void;
};

function isDisplayMode(value: string | null): value is DisplayMode {
  return value === "light" || value === "dark" || value === "system";
}

function setDarkClass(enabled: boolean) {
  document.documentElement.classList.toggle("dark", enabled);
}

function applyDarkClass(mode: DisplayMode) {
  if (mode === "dark") {
    setDarkClass(true);
    return;
  }

  if (mode === "light") {
    setDarkClass(false);
    return;
  }

  const prefersDark = window.matchMedia(SYSTEM_QUERY).matches;
  setDarkClass(prefersDark);
}

function removeSystemListener() {
  if (!systemMediaQuery || !systemListener) return;

  const mediaQuery: LegacyMediaQueryList = systemMediaQuery;

  if (typeof mediaQuery.removeEventListener === "function") {
    mediaQuery.removeEventListener("change", systemListener);
  } else if (typeof mediaQuery.removeListener === "function") {
    mediaQuery.removeListener(systemListener);
  }

  systemMediaQuery = null;
  systemListener = null;
}

function addSystemListener() {
  removeSystemListener();
  systemMediaQuery = window.matchMedia(SYSTEM_QUERY);
  systemListener = () => {
    if (getDisplayMode() === "system") {
      applyDarkClass("system");
    }
  };

  const mediaQuery: LegacyMediaQueryList = systemMediaQuery;

  if (typeof mediaQuery.addEventListener === "function") {
    mediaQuery.addEventListener("change", systemListener);
  } else if (typeof mediaQuery.addListener === "function") {
    mediaQuery.addListener(systemListener);
  }
}

export function getDisplayMode(): DisplayMode {
  const stored = localStorage.getItem(DISPLAY_MODE_KEY);
  return isDisplayMode(stored) ? stored : "system";
}

export function applyDisplayMode(mode: DisplayMode) {
  applyDarkClass(mode);
  if (mode === "system") {
    addSystemListener();
  } else {
    removeSystemListener();
  }
}

export function setDisplayMode(mode: DisplayMode) {
  localStorage.setItem(DISPLAY_MODE_KEY, mode);
  applyDisplayMode(mode);
}

export function initializeDisplayMode() {
  applyDisplayMode(getDisplayMode());
}

const FONT_SCALE_KEY = "tama_font_scale";
const DEFAULT_FONT_SCALE = 100;
const MIN_FONT_SCALE = 75;
const MAX_FONT_SCALE = 200;
const FONT_SCALE_STEP = 5;

export { MIN_FONT_SCALE, MAX_FONT_SCALE, FONT_SCALE_STEP };

function clampFontScale(value: number): number {
  return Math.min(MAX_FONT_SCALE, Math.max(MIN_FONT_SCALE, value));
}

export function getFontScale(): number {
  const stored = localStorage.getItem(FONT_SCALE_KEY);
  if (!stored) return DEFAULT_FONT_SCALE;
  const parsed = Number(stored);
  return Number.isFinite(parsed) ? clampFontScale(parsed) : DEFAULT_FONT_SCALE;
}

export function applyFontScale(percent: number) {
  const clamped = clampFontScale(percent);
  document.documentElement.style.fontSize = `${clamped}%`;
}

export function setFontScale(percent: number) {
  const clamped = clampFontScale(percent);
  localStorage.setItem(FONT_SCALE_KEY, String(clamped));
  applyFontScale(clamped);
}

export function initializeFontScale() {
  applyFontScale(getFontScale());
}
