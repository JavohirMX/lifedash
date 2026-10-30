# Journal field follow-up investigation

October28,2026, after5dd45c04. Source inspection and synthetic Chromium failure injection confirm highlight Enter/blur discards a rejected update promise, offers no error/retry, and loses unsaved text when navigating away and back to the date. Existing atomic get-or-create prevents duplicate local date records but does not address field-save feedback. Mood also discards a promise; its pending/error behavior needs separate evidence.

No Journal field change is included in the current note-title/create checkpoint. A bounded next fix should preserve current Enter/blur timing, retain failed highlight by database/date in session, serialize overlapping Enter/blur writes, label retry, and isolate late completions from other dates. This must not change journal streak calculations, mood policy, TV display, sync conflict policy, or reload durability. Existing note body recovery is separate.
