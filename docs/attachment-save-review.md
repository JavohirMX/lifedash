# Attachment write recovery

October 28, 2026. Bounded follow-up from ec9aa2bc.

The task attachment picker cleared its selected File immediately and discarded the local-write promise. A rejected add silently lost the selection, while a rejected remove produced no feedback. Add now shows pending/success/error, retains the selected File in the open task for Retry, and blocks duplicate writes. A failed selection must be retried or explicitly discarded before choosing another file. Remove failures keep the attachment listed with a clear retry instruction. Remove is still immediate when it succeeds; no new confirmation/undo policy was added.

Component state is keyed to task identity so a failed file cannot be silently reattached to another task. Names are rendered as text, not markup. Files stay in the existing local IndexedDB storage; no network upload, file limit, MIME policy, backup semantics or storage format was added.

The open-task retry follows previously read WAI notification guidance (https://www.w3.org/WAI/tutorials/forms/notifications/) and NN/g nearby actionable error guidance (https://www.nngroup.com/articles/errors-forms-design-guidelines/).

Chromium checks inject add and remove failures at1440/390/320 light/dark, retry, verify exactly one saved attachment and successful removal, with no uncaught page errors or horizontal overflow. Screenshots capture existing empty UI and new failure feedback; representative pixels inspected. This is not a real-device or whole-app accessibility claim.

The selected File is held only while this task remains mounted. Closing or switching tasks, reloading, or closing the browser discards that failed selection; the original file remains on the user's device and can be chosen again. Pending writes are not cancelled by navigation. This limitation is stated in the error. Saved on this device does not mean synced or included as binary data in JSON backup. Existing backup warnings remain unchanged.
