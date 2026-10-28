# Note deletion feedback

October28,2026, after2435cba9. A synthetic delete rejection confirmed the editor closed immediately, saved note row remained and no alert appeared. Deletion now awaits the existing transaction, keeps the original note open on rejection, shows error/retry, and guards repeat clicks while pending. Existing confirmation wording and cancel behavior are preserved. Success closes only when the originating note is still selected; other notes stay open. Successful title-draft cleanup still runs only after confirmed deletion.

No note/task unlink transaction, confirmation, undo or delete policy change. Pending deletion continues after switching notes or leaving the view; current mounted NotesView guard disables note deletion while one runs. Error keyed by origin ID is hidden on other notes. Full-view remount and cross-tab singleton behavior are not promised.

Twelve1440/390/320light/dark groups cover new note deletion cancel/failure/unchanged count/retry/held duplicate/origin isolation and existing title failure/retry/deletion cleanup.314/build pass. Actual error pixels inspected. Existing NN/g/WAI recovery guidance supports waiting for confirmed result and reporting failure near its action.

Independent focused review passed delete/title six width/theme groups and build. Extended deletion checks also confirm linked-task noteId rollback on rejection and unlinking only after success. Related note-create/checklist suites passed (18 groups combined). Landing remains local-only, with backup batched into the next related checkpoint.
