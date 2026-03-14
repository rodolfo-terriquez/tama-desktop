export const API_ONBOARDING_DISMISSED_KEY = "tama_api_onboarding_dismissed";
export const APP_LOCALE_KEY = "tama_app_locale";

function emitConfigChanged(): void {
  window.dispatchEvent(new Event("tama-config-changed"));
}

export type SupportedAppLocale = "en" | "es";

export function getSupportedAppLocale(locale: string | null | undefined): SupportedAppLocale | null {
  if (!locale) return null;
  const normalized = locale.toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-")) return "en";
  if (normalized === "es" || normalized.startsWith("es-")) return "es";
  return null;
}

export function getInitialAppLocale(): SupportedAppLocale {
  return getSupportedAppLocale(window.navigator.language) ?? "en";
}

export function getAppLocale(): SupportedAppLocale {
  return getSupportedAppLocale(localStorage.getItem(APP_LOCALE_KEY)) ?? getInitialAppLocale();
}

export function setAppLocale(locale: SupportedAppLocale): void {
  localStorage.setItem(APP_LOCALE_KEY, locale);
  emitConfigChanged();
}

export function isApiOnboardingDismissed(): boolean {
  return localStorage.getItem(API_ONBOARDING_DISMISSED_KEY) === "1";
}

export function setApiOnboardingDismissed(dismissed: boolean): void {
  if (dismissed) {
    localStorage.setItem(API_ONBOARDING_DISMISSED_KEY, "1");
    emitConfigChanged();
    return;
  }

  localStorage.removeItem(API_ONBOARDING_DISMISSED_KEY);
  emitConfigChanged();
}
