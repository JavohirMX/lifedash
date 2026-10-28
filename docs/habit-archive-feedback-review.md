# Habit archive feedback

October 28, 2026. Isolated Archive write rejection leaves habit card unchanged without alert and emits uncaught rejection. Existing Archive/Restore now await existing repository calls with the shared create/edit pending guard, status and named error instructing retry. No archive/log/schedule calculation change.

Six 1440/390/320 light/dark browser groups test both directions: rejection, unchanged saved archive state, retry and held duplicate, with no pageerrors/overflow. All six captured archive-failure pixels inspected. Build passes, existing bundle warning remains.

Pending writes continue after navigation; mounted global habit-named error clears on next archive/restore attempt. Guard is view-wide for lifecycle/create/edit, not a cross-entrypoint database lock. Habit check-in toggles remain untouched and independently executable while lifecycle write waits, as before.
