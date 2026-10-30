# Task skip feedback

October28,2026. Injected skip rejection left stored date unchanged with no alert and uncaught rejection. TaskSkip now awaits existing skipTask, guards duplicate pending actions, reports pending/failure near the original action, and allows retry using the same button. Task-keyed lifecycle isolates late feedback from another task. Skip eligibility, no-op, date advance and skipped-history logic unchanged. No success claim is added for a no-op.

Six1440/390/320 light/dark groups pass unchanged-on-failure/retry/duplicate/origin and exactly one skipped-history item. Build passes. Pending writes continue after navigation; mount-only busy/error state, no cross-tab or concurrent edits guarantees. TaskSkip retries using current task props, not a stored old task. Existing WAI/NNg recovery guidance applies.

Actual390-light/320-dark pixels inspected; independent focused review passed six groups/build. Local landing approved, combined backup with repeat recovery.
