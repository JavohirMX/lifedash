export type CompletionFailure = { id: number; title: string };
let failures: CompletionFailure[] = [];
let sequence = 0;
const listeners = new Set<() => void>();
export const completionFailures = () => failures;
export function subscribeCompletionFailures(listener: () => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export function reportCompletionFailure(title: string) {
  failures = [...failures, { id: ++sequence, title }];
  listeners.forEach(listener => listener());
}
export function dismissCompletionFailure(id: number) {
  failures = failures.filter(failure => failure.id !== id);
  listeners.forEach(listener => listener());
}
