# Note pin feedback

October 28, 2026. Isolated note-unpin write rejection left the original pin unchanged without an alert and produced an uncaught rejection. NotesView now awaits the existing updateNote call, guards pending duplicate pin clicks, shows pending feedback and an error with an instruction to retry the same pin button. Saved pin/icon ordering remains unchanged, not an optimistic pin state.

Six 1440/390/320 light/dark browser groups pass rejection/unchanged saved pin/retry/held duplicate/origin selection and successful reverse-toggle tests without pageerrors or horizontal overflow. All six captured error states visually inspected. 314 unit tests and production build pass (existing bundle-size warning).

Error/pending state is scoped to note ID while NotesView is mounted. The pending pin guard is view-wide, not a cross-entrypoint or database lock. Switching notes does not redirect the old write or close the new selection. Retry uses the current rendered saved pin, not a stored patch. No transaction, conflict policy, pin sorting, font or wallpaper change.
