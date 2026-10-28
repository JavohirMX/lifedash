# Goal status feedback

October 28, 2026. Isolated Mark done write rejection left the active goal unchanged, no alert and uncaught rejection. Existing Mark done/Archive/Reopen now await the existing updateGoal, use the shared goal-writing guard, show pending status, catch rejection and identify the goal in an error with retry instruction.

Six 1440/390/320 light/dark browser groups cover rejection/unchanged saved status/retry/held duplicate for all three actions. All six captured failure states visually inspected; no overlap or horizontal overflow. Production build passes with existing bundle warning. Test setup initially double-counted nested wrappers, corrected to reuse original table update before rerunning successfully.

No goal/task completion coupling, archive visibility, status mapping, conflict, sorting or repository change. Pending writes continue after navigation. Error is view-mounted and cleared on next status attempt; no cross-entrypoint isolation promised. Global status error is named by goal, not a retained edit draft. Status actions share create/edit pending guard.
