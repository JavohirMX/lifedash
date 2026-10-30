# Task priority save feedback

October 28, 2026, based on b2c02efc. Isolated failure injection reproduced a priority selection reverting from attempted P2 to saved P1 with no alert and an uncaught rejection. The new task-keyed field keeps a failed selection in the mounted field, awaits updateTask, shows pending/error and Retry, and guards overlapping writes. Switching tasks prevents an old pending result from changing the new field. Existing numeric values and write semantics stay unchanged; no recurrence/date/project/goal changes.

Failed selections are session component state only: closing the detail discards an unsaved selection. No unload persistence, cross-tab ordering or concurrent deletion guarantees are added. Pending writes continue after closing. Authoritative priority changes update the idle field unless an unsaved failed selection is held.

Six Chromium groups at 1440/390/320 in light/dark pass failure/retention/DB unchanged/retry/duplicate/origin/reopen, no pageerror and no horizontal overflow. 314 tests and build pass. Actual 390 light and 320 dark failure pixels inspected, readable error and retry below the select. Based on existing WAI form notification and NN/g error recovery guidance in prior recovery research.

Independent focused review PASS additionally covered change-choice-after-failure clearing the error on successful write and closing/reopening restoring saved value. Local landing approved; no push/deploy.
