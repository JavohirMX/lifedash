# Task deletion feedback

October28,2026, after7dae315d. Synthetic task.delete rejection reproduced an unhandled promise and no error while task details remained. A task-keyed button now awaits the existing deleteTask transaction, disables/guards repeat clicks while pending, and shows error/retry feedback after rejection. Success closes only while this original task's delete component remains mounted, so late completion after switching tasks cannot close new details.

No confirmation, undo, child-deletion, attachment-deletion or dependency cleanup policy was added or changed. Existing transaction rollback supports the failure copy. Pending deletion continues after closing/switching details. Guard is mounted component only, not a cross-tab or remount singleton. Error is mount-only. No claim of general deletion recovery across all entry points.

Six1440/390/320light/dark Chromium groups cover rejected deletion/unchanged record count, visible retry, held retry/forced duplicate, and switching to another task before original completion without closing it.314/build pass. Error pixels inspected; existing destructive button styling retained. Research basis is already recorded NN/g/WAI feedback guidance, not a new deletion policy.

Visual integration preserves the former full-width button after adding the feedback wrapper. Independent settled-state inspection confirms disabled=false and opacity1 after failure; retry works. Combined36width/theme groups covering deletion, task title, tags, blockers, attachments and subtasks pass, along with314/build. Independent review used accumulated source, not exact checkpoint ancestry.
