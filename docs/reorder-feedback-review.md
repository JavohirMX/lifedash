# Task list reorder feedback

Today rejected task update after synthetic drop reproduced uncaught rejection/no alert. Today/project reorder callbacks now return promise; TaskList awaits/catches, guards duplicate in-flight reorder and temporarily removes drag handlers/draggable state. Error asks to check order then drag again, no rollback claim. Existing moveTask/reorderedPosition/order-only patch untouched.

Six1440/390/320light/dark Today and project synthetic HTML5 drop rejection/retry/held duplicate groups PASS;315tests/checked-exit build PASS.390light/320dark pixels inspected notice above rows. Tests do not prove real mouse/touch long-press drag mechanics. Mounted list pending/error can survive a selection change if React reuses list; in-flight operation uses original list callback. No cross-tab lock or external-edit protection. No product ordering/filter/aggregation decisions changed.
