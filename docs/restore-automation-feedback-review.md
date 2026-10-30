# Restore automation partial-failure feedback

Baseline fb4e0664. Backup restore commits IndexedDB records before writing automation preferences to localStorage. If either automation key fails, records remain restored and automation may be partly restored. Previously only the storage exception appeared in ImportDialog.

This candidate catches only the post-records automation failure and reports that records were restored, automation was not fully restored, and records/Automation should be checked before another restore. It preserves merge-by-id, transaction boundaries, filtering, settings order, buttons and retries. No rollback, automatic retry or policy change.

Twelve Chrome cases (1440/390/320, light/dark, first/second automation key failure) check saved record, retained or partially changed automation, and rendered disclosure. Six existing restore rejection/retry and duplicate-submission groups pass. 390 light and 320 dark screenshots inspected: warning readable within dialog, no horizontal overflow. No device/storage quota exhaustion or cross-device test claim.

Four unit tests cover success counts, post-record automation failure, preserved database rejection/no automation, and validation/no writes. Full 324 app tests and build pass. Real Dexie write-failure rollback is checked in Chrome, not claimed from the unit stand-in.
