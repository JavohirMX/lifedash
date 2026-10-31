# Dev drivers

Hand-run browser drivers that exercise Lifedash against a real local sync
server with synthetic data. They are development tools: not shipped, not run
by CI, never started by `npm test`. Each driver manages the sync server
process itself and must be run on a machine with Chrome/Chromium and Python
(the server's `requirements-dev.txt` installed for the user).
Drivers reuse fixed database paths under /tmp (shown in each Run section and
overridable via environment variables); a rerun after an interrupted run
can hit stale state - delete the files or point the variables at fresh
paths.

## attach-retry-drv.cjs

Written against checkpoint `b64b2228` (branch `fix/ux-repairs-combined`).
Proves the attachment upload failure/retry contract end to end:

- The prompt (immediate) blob upload at attach time is best-effort; its
  outcome is unrecorded by design. The sync backfill owns failure tallies,
  backoff and UI surfacing.
- Transient refusal (structured 413 `attachment_quota_exceeded`, server
  started with `SYNC_ATTACHMENT_QUOTA_MB=0`): auto sync retries once and
  records the tally; the next auto sync respects exponential backoff; manual
  "Sync now" clears backoff and re-attempts honestly; once the server has
  room again, "Sync now" heals the upload with byte-identical content.
- Permanent refusal (structured 413 `attachment_file_too_large`, server
  started with `SYNC_ATTACHMENT_MAX_FILE_MB=0`): the recorded permanent tally
  suppresses auto-sync retries; manual "Sync now" re-attempts once and
  re-records; the UI warning with its Retry button appears only after a
  recorded failure, and Retry heals the upload once the server accepts the
  size.

Run it:

    cd app && npm run build
    (cd dist && python3 -m http.server 4174 --bind 127.0.0.1 &)
    node dev-drivers/attach-retry-drv.cjs

Environment overrides: `CHROME_EXE`, `APP_URL`, `SYNC_PORT`, `SERVER_DIR`,
`RETRY_DB_A`, `RETRY_DB_B`. Both scenario databases are disposable SQLite
files under /tmp by default. The driver kills the server processes it spawns;
it uses dedicated ports, so run it on a quiet checkout.
