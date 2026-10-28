# Subtask capture recovery

October 28, 2026. Follow-up frome59788c1 while checklist conversion is reviewed separately.

The existing Enter-only subtask input cleared its draft before its ignored write promise resolved. A rejected write lost the text with no feedback. Its state also lived in the task detail component rather than being scoped to parent task identity.

A small parent-keyed capture component adds an accessible input label and visible Add subtask action. It waits for local success before clearing, retains failures in the open parent with an inline retry instruction, shows pending/success status, and blocks duplicate submits and input-method composition submission. Existing parentId/project/due-date inheritance is preserved. No completion, deletion or ordering policy change.

Fault-injection Chrome checks at1440/390/320 light/dark verify failure retention, successful retry creating one child, and no draft moving to a different parent. The draft is only retained while this parent component is mounted; close/navigation/reload discards it. Pending writes continue for the original parent. This is not persistent draft storage or a cross-device feature.
