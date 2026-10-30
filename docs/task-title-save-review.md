# Task title save recovery

October28,2026, after3a471211. Rejected task-title update was reproduced as an unhandled rejection with no error/retry, and exact typed text disappeared after close/reopen. The input now uses a controlled per-database/task session draft, ordered immediate writes, saving/local-saved feedback and explicit Retry title. It preserves existing immediate-save timing and blank-title acceptance; no new validation policy. Other task properties, recurrence and sync policy remain unchanged.

Drafts and write queues survive closing/reopening details in this browser session. Different task IDs do not share drafts. Snapshot identity prevents an older completion clearing a newer draft; external saved title refreshes when no local draft remains. Session-wide browser-leave warning covers pending/failed title drafts even while detail is closed. Reload/crash durability is not promised.

A session-wide live query observes authoritative task IDs and prunes title drafts only when their task is confirmed absent, covering detail/project deletion and other page connections. Read failure is not deletion proof and retains drafts/warnings. This changes no delete policy or transaction. Snapshot identity prevents a pending completion from reinserting a discarded draft. No cached UI child list is used.

Six1440/390/320light/dark Chromium checks cover forced title rejection, exact close/reopen retention, different-task isolation, retry/warning clearing, held older/newer writes across remount, and confirmed project-deletion cleanup while details are closed. Error pixels inspected, retry minimum44px.314 tests/build pass. Existing recorded NN/g/WAI form-error feedback guidance supports the change; no new feature opt-in or cross-device policy.

Independent correction review also passed two-task deletion isolation and injected authoritative primaryKeys read failure: surviving text/warning is preserved. Observer error recovery is not proven; an error may terminate observation, leaving a conservative warning for later deletions until reload. No guaranteed automatic cleanup after read failure is claimed.
