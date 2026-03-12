export const API_ONBOARDING_DISMISSED_KEY = "tama_api_onboarding_dismissed";

export function isApiOnboardingDismissed(): boolean {
  return localStorage.getItem(API_ONBOARDING_DISMISSED_KEY) === "1";
}

export function setApiOnboardingDismissed(dismissed: boolean): void {
  if (dismissed) {
    localStorage.setItem(API_ONBOARDING_DISMISSED_KEY, "1");
    return;
  }

  localStorage.removeItem(API_ONBOARDING_DISMISSED_KEY);
}
