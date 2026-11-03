import { describe, expect, it, beforeEach, vi } from 'vitest';
import { isOnboardingDone, markOnboardingDone } from './onboarding';

// Node environment: minimal localStorage shim.
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
});

describe('onboarding flag', () => {
  beforeEach(() => store.clear());
  it('shows on first run, then stays dismissed', () => {
    expect(isOnboardingDone()).toBe(false);
    markOnboardingDone();
    expect(isOnboardingDone()).toBe(true);
  });
});
