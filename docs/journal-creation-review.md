# Journal same-day creation race

October 28, 2026. Follow-up from9f70c90a; no UI layout change.

## Reproduction

The existing get-or-create function queried a day and then inserted outside a transaction. Two concurrent callers on an empty day returned different record IDs. In real Chromium with sample data, one record held mood4 and an empty note; another held note text and null mood. JournalView chooses a single matching day record, hiding the other content. Concurrent mood, highlight and debounced note saves make this path reachable.

## Bounded fix

Keep lookup and creation in one IndexedDB read-write transaction. Concurrent calls, including separate browser connections, use the same new row. No schema migration, uniqueness constraint, existing-row cleanup, merge policy or data deletion is added. Imported duplicate dates and duplicates already stored remain untouched; deciding which existing content to keep is outside this fix.

## Proof and limits

Before script failed with two rows. After script runs eight rounds of parallel calls and separate browser-page connections, verifies one shared ID and retained independent fields, then injects creation failure and verifies no partial row and successful retry.314 app tests and production build pass. Actual Journal UI behavior and all prior save statuses are unchanged; no new visual comparison is needed. No server synchronization or cross-device uniqueness claim is made. Server/import paths can still introduce same-date duplicates because date is not globally unique.
