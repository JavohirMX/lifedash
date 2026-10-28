# Task tag save recovery

October28,2026, after430f388a. Synthetic rejection confirmed tag add discarded its update promise, cleared typed text and offered no error. Blocker add also had an unhandled rejection/no feedback; that is separate from this candidate.

TaskTags now awaits add/remove, keeps failed add text, shows specific error/retry instructions, exposes a labeled New tag field and Add tag action, and guards/disables add/remove while pending. Existing Enter remains, with composition Enter prevented from submitting. Add/remove still use existing normalization/set behavior. A task-keyed child isolates drafts/errors when switching details. Drafts are mount-only, not retained after close/reopen; pending writes still finish for their original task. No tag rename/merge policy or cross-tab ordering change.

Six1440/390/320light/dark Chromium groups cover rejected add and retry, rejected remove and retry, normalization, held add/forced duplicate, composition key and origin-task identity after switching.314/build pass. Error screenshots inspected; Add tag minimum44px. Existing small chip remove target is not claimed fixed. Research basis is the previously recorded NN/g/WAI form-error and feedback guidance.
