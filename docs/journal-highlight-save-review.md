# Journal highlight recovery

October28,2026, after8a28f21c. The reproduced baseline failure is recorded in journal-field-investigation.md: rejected highlight update was unhandled, no error/retry appeared, and date navigation lost text.

The existing Enter/blur timing is preserved. A controlled highlight field retains drafts per database/date in memory, displays saving/local-saved feedback, and offers explicit Retry highlight after a failed write. Enter ignores input-method composition. Blur saves only newly edited values, not a known failed draft, so navigating away does not silently retry it. Returning to the date or to Journal restores the draft/error. A session-wide browser-leave warning covers unsaved highlights even after leaving Journal. No reload/crash durability claim.

Per-date queues serialize writes, and a snapshot identity guard keeps an old completion from deleting a newer draft. Enter followed by blur while the same snapshot is pending does not enqueue a duplicate. Highlights continue to be trimmed or stored as null when blank. The field waits for initial entries to load and accepts later saved values only when no local draft is pending. Existing get-or-create transaction handles first entry creation. Mood buttons, journal streak, body editor, TV logic and sync policy are unchanged.

Six1440/390/320 light/dark Chromium groups force a failed update, retain error across dates/full Journal unmount, retry, verify beforeunload clearing, hold an older write and save a newer highlight, and check IME Enter. Desktop/mobile pixels inspected; mobile retry minimum44px.314 tests and build pass. Same-session drafts are not remote sync or backup. Existing same-field cross-device behavior is unchanged.

Design basis: already recorded NN/g form-error guidelines and WAI form notifications, preserving entered values and actionable nearby errors. No new product feature or policy is implied.
