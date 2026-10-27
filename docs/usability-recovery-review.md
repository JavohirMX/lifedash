# UI/UX guides applied to task capture and local saves

October 27, 2026. Review of the 3053f6bf baseline using source inspection, fictional sample data, and browser fault injection. This is a new recovery-focused pass, not a repeat of the earlier navigation, scope, habit creation, fonts or wallpaper work.

## Findings and applied changes

| Priority | Reproduced gap | Change | Evidence |
| --- | --- | --- | --- |
| High | Quick capture cleared text before checking the parsed title; one rejected write left its promise chain rejected, blocking later captures. | Validate before clearing, keep failed raw text with Retry, recover the write queue, announce saving and successful local writes. Rapid entries remain serialized. | Injected IndexedDB add failure, successful later capture, retry exactly once, three rapid entries in order. |
| High | Rich-text callers discarded write promises, so the shared editor could not tell whether Notes, task details or journal text saved. | Await returned promises, serialize writes, show Saving / Saved on this device / actionable error with Retry. Keep a session-only draft across internal navigation; returning to the editor shows the recovered draft for review and explicit Retry, without replacing the saved record automatically. Flush pending debounce on close, warn on browser leave while unsaved. | Injected rejected note update, text retained, navigate away after failure and return recovers text without saving it until Retry; retry persisted, delayed writes preserve latest text, navigation flush persisted. |
| High | Task import rejected without visible recovery. Missing source projects could be committed before task import failed. | Catch file-read and import failures; retain source and preview; wrap project creation and task writes in one transaction. Add source-text and destination accessible labels. | Failure after a new source project was created rolls back both projects and tasks; retry imports successfully. |
| Medium | Quick capture had no visible submit button and its parsed date/time hint overlaid typed text on narrow screens. | Visible Add action and New task label, parsed hint on a separate wrapping line, linked instructions and errors. Keep Enter support and avoid submission during input-method composition. | Desktop and 390px before/after pixels; 320px, light and dark fit checks. |

Settings recovery findings and their sources are recorded separately in [form-feedback-review.md](form-feedback-review.md). They cover URL boundary validation, human-readable sync errors and style/mode storage failures. These changes were integrated and checked together.

## Research-to-decision trail

1. [NN/g, 10 Design Guidelines for Reporting Errors in Forms](https://www.nngroup.com/articles/errors-forms-design-guidelines/), February 3, 2019, reviewed December 12, 2024. Independent usability guidance. Supports actionable nearby errors, preserving context, and avoiding disruptive dialogs for routine correction. Used for capture/import recovery, not speculative restyling.
2. [NN/g, Website Forms Usability: Top 10 Recommendations](https://www.nngroup.com/articles/web-form-design/), May 1, 2016. Independent usability guidance. Supports adjacent labels, clear actions, preserving erroneous input and specific messages. Applied to capture labels/actions and import labels.
3. [W3C WAI, Form Instructions](https://www.w3.org/WAI/tutorials/forms/instructions/). Primary accessibility guidance. Placeholder text is not a label; instructions should be linked to controls. Applied to the capture label and described hint/error.
4. [W3C WAI, User Notification](https://www.w3.org/WAI/tutorials/forms/notifications/). Primary accessibility guidance. Provide clear results for success and failure, including asynchronous feedback. Applied to local save status and alert semantics.
5. [W3C WAI, Validating Input](https://www.w3.org/WAI/tutorials/forms/validation/). Primary accessibility guidance. Validate usable input with accessible correction; client validation is not server security. Applied to capture validation and integrated Sync URL checks.
6. [GOV.UK Design System, Error message](https://design-system.service.gov.uk/components/error-message/). Official design-system implementation guidance, including published live-service research. Retain entered information and distinguish user-input errors from service failures. Applied to retaining source/drafts and non-blaming storage error copy.
7. [NN/g, User Control and Freedom](https://www.nngroup.com/articles/user-control-and-freedom/), November 29, 2020. Independent usability guidance. Reviewed for recovery and visible controls. No change to delete, archive or conflict policy was inferred from this guide.

These sources agree on clear feedback and preserving effort. They differ on native form-validation implementation: GOV.UK's tested component system disables native validation, while W3C describes using it. We did not transplant either platform's full rules or claim their research predicts Lifedash outcomes. This pass uses explicit boundary checks where the existing controls were not inside a validating form.

## Validation and limits

- 314 app tests and TypeScript/Vite production build pass after integration.
- Independent review found and closed two draft-recovery edge cases: cross-table imported ID aliasing, and stale failure copy after a pending save completed during remount. Drafts and queues include collection identity; remounted editors reconcile the same snapshot completion without marking newer edits saved. A dedicated browser fixture locks both cases down.
- Existing keyboard checks pass at desktop and mobile.
- New fault-injection browser checks cover 1440px, 390px and 320px, light and dark. Settings authentication responses are intercepted, and all data is fictional.
- Existing Google UI, font, remaining routes, Settings navigation/appearance, wallpaper, Home and habit checks passed in bounded groups. No real provider authentication, sync account or deployed site was used.
- Actual screenshots were inspected for field/hint overlap, error/retry readability, save-status placement and horizontal overflow. This is not an actual screen-reader test, user study, or whole-app WCAG claim.
- "Saved on this device" means the local write resolved. It does not promise remote sync or backup.
- Failed editor drafts are held in memory for this browser session, keyed by the active database, collection and record. Returning shows the draft for review, not a silent overwrite. Browser reload, tab close, crash and storage failure cannot guarantee persistence; error copy tells the user to retry or copy before closing. No background retry or cross-device draft sync was added. Quick capture failure cards also return across navigation within this browser session, kept separate from saved tasks. Tab closure or reload loses these session-only drafts.
- This pass does not retrofit every form. Habit/goal create and note-title changes still have separate write paths. No claim is made that every write in the app now has recovery feedback.
- Approved Inter default, explicit font choices, wallpaper, view scopes, delete behavior, sync conflicts and server registration policy are unchanged. No new behavioral feature, deployment or public release was added.
