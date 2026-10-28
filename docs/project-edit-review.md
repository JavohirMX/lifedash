# Project edit save recovery

October 28, 2026, follow-up from21ae4eed. Existing project settings closed immediately after an ignored update promise. Save now awaits success; failure retains name and color with recovery feedback; pending disables settings, name/color controls and action buttons, with a synchronous duplicate guard and composition Enter guard. Async completion/errors only affect the currently selected originating project, not a different project after navigation. Project deletion logic, hierarchy and color options are unchanged. Cancel and navigation still discard this form draft; no reload persistence. Pending writes continue for the original project.

Six viewport/theme Chromium fault checks retain failed name/color and retry into exactly one matching record.314 tests and build pass. No whole-app accessibility claim.
