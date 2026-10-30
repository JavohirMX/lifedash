# Backup record roundtrip proof

Test-only regression on b659f306. Explicit sample database guard before clearing any table. Export JSON, clear all eight restored record tables, restore, compare every sorted row exactly for each nonempty collection, compare both automation stores, and verify returned record counts. Seeded completed focus row avoids introducing a running-session reconciliation case. Fictional attachment metadata exported without binary; attachment table deliberately not cleared, no binary restore claim.

Twice passed in real Chrome/Dexie. No product source change, new storage, real user data, reload or cross-device claim. Other fixtures separately cover invalid records/DB rollback and post-commit settings failures.
