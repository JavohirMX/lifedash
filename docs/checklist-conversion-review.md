# Notes checklist conversion recovery

October 28, 2026. Follow-up frome59788c1.

The existing Notes checklist conversion read linked titles and added tasks one at a time outside a transaction, with no pending guard or catch. Injecting failure on the second new task left the first new task committed and raised an uncaught error. Concurrent conversions could both pass the title-dedup check.

A repository function now reads the saved note and linked task titles, applies the existing unchecked-item extraction and case-insensitive dedup rules, then adds the full set in a single transaction. A failure rolls back all new tasks. Repeated or concurrent calls serialize the dedup check. The UI shows pending/error feedback, disables repeated conversion during the write, and scopes results/errors to the originating note. Retry remains the same existing conversion button.

No change to checklist checked-state, original note text, Inbox destination, linked-task policy, task title dedup semantics, or archive rules. Conversion reads the saved note document, not an unconfirmed unsaved rich-text draft. Existing manually created duplicates are not removed. No cross-device/server uniqueness guarantee.

Chrome checks at1440/390/320 light/dark inject second-task failure, verify no partial task remains, retry, repeat conversion with no duplicates, and run two same-database page connections concurrently with counts0+2 and exactly two tasks.314 app tests/build pass. Error pixels inspected for readability; no actual screen-reader claim.
