/**
 * First-run onboarding flag (product decision 2026-11-03: onboarding offers
 * sync setup on first open, with a skip option - local use stays fully
 * supported, no mandatory account). Stored per browser, like sync settings.
 * Existing users see the screen once after upgrading; Skip dismisses it.
 */
const KEY = 'lifedash-onboarding-done';

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // storage unavailable: never block the app on a welcome screen
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* nothing to persist; the screen may reappear next load */
  }
}
