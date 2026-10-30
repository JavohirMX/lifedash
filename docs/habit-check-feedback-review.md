# Habit check-in feedback

October 28, 2026. Isolated Mark done rejected log write left saved state unchanged without alert and emitted uncaught rejection. Today and calendar controls now await existing toggleHabitForDate with pending/error keyed to habit/date. Both same-date controls share pending guard, while other dates/habits remain usable. Failed saved state stays unchanged, retry toggles the current saved state rather than replaying a desired value.

Six 1440/390/320 light/dark groups cover check and undo rejection/unchanged state/retry/shared-control duplicate suppression plus another date succeeding while original write waits and another habit staying enabled. Six error-state pixels inspected. Build passes with existing bundle warning. Original unscheduled-day disable condition retained in source; dedicated unscheduled-day browser injection not included.

No log repository transaction, schedule, streak or rate change. Pending writes continue after navigation; feedback exists only while view mounted. No cross-entrypoint/tab or external log-change isolation. Errors keyed to date may remain until that date is retried, even if another date succeeds.

Independent focused review passed six recovery groups/build and additional390light unscheduled-day injection: weekdays=[] made all displayed calendar cells disabled, Today action absent and not-scheduled label visible. Local landing accepted.
