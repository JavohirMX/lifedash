# Goal and habit form save recovery

October 28, 2026. Follow-up from355f5490, not a repeat of its completed tests or visual redesign.

## Reproduced gap

Goal and habit create/edit handlers discarded their write promises, then cleared inputs and closed the form. A rejected local write silently lost the entered title/date or name/weekdays. The completed355f5490 memo explicitly excluded these paths.

## Bounded change

Both pages now wait for successful create/edit writes before clearing or closing. A pending write shows Saving and disables the affected form and record edit/archive controls; a synchronous guard prevents repeated Enter/click submissions. A failure leaves the form and values intact with an actionable inline error. A successful result says saved/added on this device. Input-method composition does not submit prematurely.

No changes to habit frequency, streaks, completion, goal progress, archive/restore semantics, fonts, wallpaper, sync conflicts or backend. Existing layout is retained. Fieldsets keep the forms disabled together while preserving existing spacing.

## Guidance already read and applied

- https://www.w3.org/WAI/tutorials/forms/notifications/ : clear asynchronous success/error feedback.
- https://www.nngroup.com/articles/errors-forms-design-guidelines/ : visible nearby recovery instructions.
- https://design-system.service.gov.uk/components/error-message/ : retain entered information and avoid blaming users for service/storage failures.

## Checks and limits

New Chromium checks at1440/390/320, light/dark, inject create and edit failures on both pages, verify all title/date/schedule fields retained, retry, verify one saved record, and hold a write while attempting repeated submission. Existing habit creation/schedule checks,314 app tests and production build pass. Before/after desktop/mobile screenshots were captured; representative narrow error pixels inspected directly. No whole-app accessibility or real-device claim.

These forms retain failed drafts while they remain open. Cancel and internal navigation still leave a form, and reload/tab close does not recover those values. They do not inherit the rich-text editor's session-draft map. Pending writes are not cancelled by navigation. Existing habit toggle/archive and goal done/archive writes remain separate paths and are not claimed fixed. This change is local only until separately authorized to push or deploy.
