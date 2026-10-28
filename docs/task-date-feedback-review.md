# Task date and time save feedback

October 28, 2026, against dfa9288e. Isolated failure injection reproduced due date2026-10-27 ->2026-11-01 and empty time ->15:30 silently reverting on rejected writes, stored values unchanged, no alert and one uncaught rejection each. TaskDateField awaits updateTask, keeps failed choice while mounted, reports pending/failure with Retry, guards duplicate writes and scopes late results to the originating task.

Date/time remain native input controls with existing nullable mapping. Time remains conditional on the saved date, so failed date edits don't change time visibility and successful date clearing hides it. Recurrence rules and retained dueTime data on cleared date are unchanged. No scheduling policy change.

Twelve1440/390/320 light/dark groups cover rejection/retained choice/DB unchanged/retry/duplicate/origin/reopen plus successful clearing to null and date-dependent time hiding.314 tests/build pass. Actual390-light date and320-dark time pixels inspected; readable errors and Retry.

Failed choices live only in the mounted component, discarded on close. Pending writes continue after navigation. No cross-tab singleton, disappearing-option or concurrent task-deletion guarantees added. A separate native date/time arrow/Tab check confirms focus retention across segmented edits. An initial disabled-pending candidate lost focus on date change; readOnly plus aria-disabled now prevents edits while pending without that focus loss. Full native picker interaction is not separately proved.

Independent focused review PASS: twelve groups, keyboard smoke and build. Chromium calendar icon popup ArrowRight+Enter selection persisted through held write with one write only; readOnly blocked ArrowUp/showPicker during pending and Tab exited. Native time popup/non-Chromium/mobile OS pickers remain untested. Local landing approved.
