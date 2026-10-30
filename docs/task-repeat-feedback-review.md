# Task repeat save feedback

October28,2026 against6aff8120. Failure injection reproduced daily selection reverting to none with unchanged saved rule/date, no alert and uncaught rejection. TaskRecurrence now awaits updateTask, retains attempted choice, reports pending/error/Retry and guards duplicate changes, with task-keyed lifecycle. Retry reuses the attempted patch, including its original due-date anchor, rather than silently re-anchoring at retry time.

Original currentChoice mapping, makeRecurrence, default N=3, minimum-one normalization, invalid-rule warning, and recurrence-only clearing remain unchanged. No parser/interval initialization policy change. Skip occurrence stays in TaskDetail unchanged, not part of this fix. Mounted-only failed selection is discarded on close and pending writes continue after navigation. No cross-tab ordering/concurrent deletion guarantees.

Six1440/390/320 light/dark groups pass failure/retention/DB unchanged/retry/duplicate/origin/reopen. Extra semantics suite passes invalid rule replacement, exact anchored retry, N-days save/ArrowUp focus, daily/weekly/monthly and clearing.314 tests/build pass. Actual mobile light/dark pixels inspected; screenshot includes action/error. Existing WAI/NNg error recovery guidance applies.

Independent focused review passed six recovery groups, semantics/build. Stronger anchor test changed saved dueDate meanwhile: Retry replayed original patch as intended. This can overwrite a due date changed meanwhile; no concurrency guarantee. Local landing approved.
