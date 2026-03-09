export type DisplayMode = "light" | "dark" | "system";

const DISPLAY_MODE_KEY = "tama_display_mode";
const SYSTEM_QUERY = "(prefers-color-scheme: dark)";

let systemMediaQuery: MediaQueryList | null = null;
let systemListener: ((event: MediaQueryListEvent) => void) | null = null;

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

  const mediaQuery = systemMediaQuery as any;

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

  const mediaQuery = systemMediaQuery as any;

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
