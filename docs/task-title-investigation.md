# Task title follow-up investigation

October28,2026. Existing TaskDetail title is controlled directly by saved task.title and calls void updateTask on every keystroke. A synthetic Chromium rejected db.tasks.update confirmed an unhandled rejection with no visible alert/retry. Navigation/draft loss not separately tested. No task-title fix is included in the Journal checkpoint.

A bounded next pass should reproduce retained-value behavior and held updates, then consider the same-session per-database/task draft and ordered-save pattern already used for note titles. Preserve existing immediate-save timing, blank-title behavior until separately decided, task identity, deletion/recurrence semantics and sync policy. This is research context, not a changed product decision.
