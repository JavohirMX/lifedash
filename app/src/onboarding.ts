/**
 * First-run onboarding flag (product decision 2026-11-03: onboarding offers
 * sync setup on first open, with a skip option - local use stays fully
 * supported, no mandatory account). Stored per browser, like sync settings.
 * Existing users see the screen once after upgrading; Skip dismisses it.
 */
const KEY = 'lifedash-onboarding-done';
const FRESH_KEY = 'lifedash-fresh-install';

export function isOnboardingDone(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return true; // storage unavailable: never block the app on a welcome screen
  }
}

/**
 * The seed creates the Inbox project on first load, so "has projects" cannot
 * distinguish a brand-new install from an established one on the NEXT load.
 * This marker is written at the moment the database is first created and is
 * the durable fresh-install signal: installs that already had data before
 * onboarding existed never carry it, so they never see the welcome.
 */
export function markFreshInstall(): void {
  try {
    localStorage.setItem(FRESH_KEY, '1');
  } catch {
    /* without storage the welcome stays gated off */
  }
}

export function isFreshInstallPending(): boolean {
  try {
    return localStorage.getItem(FRESH_KEY) === '1' && !isOnboardingDone();
  } catch {
    return false;
  }
}

export function markOnboardingDone(): void {
  try {
    localStorage.setItem(KEY, '1');
    localStorage.removeItem(FRESH_KEY);
  } catch {
    /* nothing to persist; the screen may reappear next load */
  }
}
