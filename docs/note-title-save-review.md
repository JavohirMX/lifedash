# Note title save recovery

October 28, 2026, follow-up from5dd45c04. The title input previously read saved live-query props and ignored the update promise. A failed write had no message or retry, and a subsequent render could reset the visible title.

The title now has a controlled input, saving/saved/error text and Retry title. Session-only drafts are keyed by database and note. Per-note queues order writes across internal navigation, preventing an older held save from replacing a newer title. Returning to an unsaved note restores its title/error. Successful external title changes still appear when no local draft is pending. Session-wide before-unload warns while any title draft remains, even after leaving Notes. No guarantee of persistence after reload/browser close; no internal-navigation prompt. Note deletion and pinning policies are unchanged. This does not claim multi-device conflict resolution.

Six Chromium width/theme checks cover injected rejection, same-session navigation isolation, retry, and a held older write followed by latest title.314 tests and build pass. Mobile title feedback uses a full row and44px retry target.

This follows the already recorded research on preserving entered values and readable recovery feedback (NN/g errors in forms and WAI form notifications). No new feature or policy opt-in.

Successful existing note deletion clears its title draft/warning only after the delete transaction resolves. Rejection keeps the draft; the existing close-on-delete behavior and absence of delete recovery feedback are not fixed by this title change. Pending saves still write only their original note ID.
