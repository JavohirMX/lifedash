# Task list row pin feedback

October 28, 2026. Isolated Today row pin rejection preserved saved pin, no alert and uncaught rejection. TaskRow now awaits existing togglePin with pending duplicate guard and error asking to retry same button. Saved icon/order/row navigation retained, no optimistic value. Feedback wraps onto its own full-width line under row controls.

Six 1440/390/320 light/dark rejection/unchanged saved pin/retry/held duplicate/reverse-toggle groups and build pass; six error screenshots visually inspected. Original reproduction and test selector corrections preserved locally; matched task title rather than blocker metadata and visible mobile Today button.

Component-local guard, no cross-row instance/TaskDetail/cross-tab isolation. Pending write continues on navigation; state discarded on unmount. Existing togglePin uses captured rendered saved task value. No repository/sorting/completion behavior change. TaskList keys originating row by task ID.
