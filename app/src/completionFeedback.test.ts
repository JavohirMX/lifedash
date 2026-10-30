import { describe, expect, it } from 'vitest';
import { completionFailures, dismissCompletionFailure, reportCompletionFailure, subscribeCompletionFailures } from './completionFeedback';
describe('completion failure notices', () => {
  it('keeps notices until explicitly dismissed and supports multiple failures', () => {
    let changes = 0;
    const unsubscribe = subscribeCompletionFailures(() => changes++);
    reportCompletionFailure('One'); reportCompletionFailure('Two');
    const notices = completionFailures();
    expect(notices.map(n => n.title)).toEqual(['One', 'Two']);
    expect(notices[0].id).not.toBe(notices[1].id);
    dismissCompletionFailure(notices[0].id);
    expect(completionFailures().map(n => n.title)).toEqual(['Two']);
    expect(changes).toBe(3);
    unsubscribe(); dismissCompletionFailure(notices[1].id);
    expect(changes).toBe(3); expect(completionFailures()).toEqual([]);
  });
});
