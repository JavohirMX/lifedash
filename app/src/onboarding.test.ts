import { describe, expect, it, beforeEach, vi } from 'vitest';
import { isOnboardingDone, isFreshInstallPending, markFreshInstall, markOnboardingDone } from './onboarding';

// Node environment: minimal localStorage shim.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

describe('onboarding flags', () => {
  beforeEach(() => store.clear());

  it('an install without the fresh marker never sees the welcome (upgrades)', () => {
    expect(isFreshInstallPending()).toBe(false);
  });

  it('fresh install: pending until Skip or successful setup, across loads', () => {
    markFreshInstall();
    expect(isFreshInstallPending()).toBe(true);
    // a reload with no dismissal keeps it pending
    expect(isFreshInstallPending()).toBe(true);
    markOnboardingDone();
    expect(isFreshInstallPending()).toBe(false);
    expect(isOnboardingDone()).toBe(true);
  });

  it('dismissal clears the fresh marker too, so a later flag loss cannot revive it', () => {
    markFreshInstall();
    markOnboardingDone();
    store.delete('lifedash-onboarding-done'); // flag lost somehow
    expect(isFreshInstallPending()).toBe(false); // marker gone: stays hidden
  });
});
