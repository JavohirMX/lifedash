# Lifedash sync protocol (v1)

Self-hosted, per-user sync between Lifedash clients. Design goals:
simple to self-host (one SQLite file), offline-first clients, no data
loss on concurrent edits, honest about what it is not (it is not
real-time collaboration).

## Model

- Collections: `tasks`, `projects`, `tags`, `habits`, `habitLogs`, `goals`,
  `notes`, `journal`, `focusSessions`, `attachments`, `automationRules`,
  `userRules`, `deviceSettings`. An entity is an opaque JSON
  blob (`data`) keyed by `(collection, id)`; ids are client-generated.
- Each user has one monotonic revision counter. Every applied change
  increments it and stamps the entity with the new `rev`. The counter
  is the sync cursor.
- Deletes are tombstones (`deleted: true`, empty data) so other clients
  learn about them.

## Auth

`POST /api/register` and `POST /api/login` take `{username, password}`
and return a bearer token (`Authorization: Bearer <token>`).
Registration closes after the first user unless the server runs with
`SYNC_OPEN_REGISTRATION=1`. Passwords are PBKDF2-HMAC-SHA256; tokens
are random 256-bit strings stored server-side.

## Pull

`GET /api/changes?since=N` returns the **latest state** of every entity
with `rev > N` (not full history), ordered by rev, plus the current
counter value. The client applies each entity (or removes tombstoned
ones) and stores `rev` as its new cursor.

First sync: `since=0` returns everything.

## Push

`POST /api/changes` with `{changes: [{collection, id, base_rev,
deleted, data}]}`. For each change the server compares `base_rev` to
its current rev for that entity:

- match -> applied, entity gets a fresh rev, result `{status: "ok", rev}`.
- mismatch -> not applied; result `{status: "conflict", current}` where
  `current` is the server's version. **Server wins** in v1: the client
  takes `current`, discards its local edit for that entity, and may
  re-express the intent afterwards (e.g. re-apply on top of the new
  base). Entities carry their own `updatedAt` inside `data`, which a
  future v2 can use for field-level last-writer-wins merge.

New entities use `base_rev: 0`; the write applies only if the entity
does not exist server-side.

Batches are applied in one transaction; a per-entity conflict does not
abort the rest of the batch.

## Attachment blobs

Blob bytes never ride `/api/changes`: attachment entities carry metadata
only, and the reference client strips `blob` from `data` on push. The
server maintains `blobOnServer` inside the entity from what is actually
on disk. Bytes move through two dual-auth routes (session bearer token,
or a write-scoped agent API key):

`POST /api/attachments?task_id=<id>&filename=<name>&id=<id>` with the
raw file as the request body creates the entity and stores the blob
atomically; a rolled-back entity never leaves an orphaned file. The
client passes its local attachment id so the local row and the server
entity converge on one identity:

- A retry of the same id with the same bytes returns the existing
  entity (idempotent).
- When metadata arrived first via push and no blob is on disk yet, the
  upload completes that row instead of conflicting.
- Same id with a different task or different bytes -> 409; empty body
  or unsafe id -> 422; unknown task -> 404.
- Over the per-file cap -> 413 with a machine-readable
  `{"detail": {"reason": "attachment_file_too_large", ...}}`; over the
  disk-measured total quota (retained deleted blobs count) -> 413 with
  `{"detail": {"reason": "attachment_quota_exceeded", ...}}`. Caps:
  `SYNC_ATTACHMENT_MAX_FILE_MB` (default 25 MB) and
  `SYNC_ATTACHMENT_QUOTA_MB` (default 200 MB).

`GET /api/attachments/<id>/content` returns the bytes with `nosniff`
and attachment disposition; 404 for unknown or unsafe ids. Blob paths
are built only from whitelisted ids, and filenames are sanitized
server-side.

Reference-client retry contract: after a push announces the metadata,
the backfill uploads any local blob not yet on the server, a few per
sync. Permanent refusals (404/409/422, or a file-too-large 413) stop
automatic retries for 24h and surface in the UI with a manual Retry;
quota 413s and transient failures retry with exponential backoff and
never strand the blob. A manual "Sync now" resets the failure tallies
and re-attempts once.

## Client responsibilities

- Track per-entity `base_rev` (server rev last seen) and a dirty set
  for local edits; debounce pushes, pull on reconnect/focus.
- Persist the pull cursor (`rev`) per account.
- Local edits to an entity that later arrives in a pull: the local
  dirty version wins and is pushed next (client already knows its
  base_rev; if the server moved meanwhile the push conflicts and
  server-wins applies).
- Malformed pulled entities (non-object data, or an inline id that
  contradicts the server key) cannot be applied as delivered: the
  reference client quarantines them locally ("kept for review" in the
  sync status) and advances the cursor past them. The quarantine is a
  bounded recent-failure buffer, not durable unlimited recovery: it
  keeps at most 20 entities (oldest evicted first, with a durable
  overflow tally of evicted counts and the last reason), and payloads
  over 64 KB are recorded by size, not kept whole. Any other apply
  failure (quota, transient storage errors) aborts the pull BEFORE the
  cursor advances so the next sync retries the entity - a valid entity
  is never skipped past silently.

## Out of scope for v1

- Real-time push to clients (poll on focus/interval instead).
- Field-level merge and multi-user/shared lists.
