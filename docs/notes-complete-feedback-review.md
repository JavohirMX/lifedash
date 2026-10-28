# Notes linked-task completion handling

Home wrapper accepted and locally committed588d0a29. Notes linked-task button now uses same CompletionButton with unchanged class, label, children and non-archived linked filter. Reproduced rejected task update producing uncaught rejection previously despite global notice. Wrapper awaits/catches and disables per-instance pending completion.

Six1440/390/320light/dark linked Passport completion and undo failure/retry/held duplicate groups PASS; checked-exit build PASS.390light/320dark screenshots inspected readable with persistent notice and linked task. Correction: linkedActive excludes archived only. Done tasks remain with Mark not done; completion and undo are both covered. No linkage/checklist/filter/gate/repo/automation changes. Same session-memory notice and per-instance guard limits.
