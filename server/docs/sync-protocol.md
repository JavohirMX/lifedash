# Lifedash sync protocol (v1)

Self-hosted, per-user sync between Lifedash clients. Design goals:
simple to self-host (one SQLite file), offline-first clients, no data
loss on concurrent edits, honest about what it is not (it is not
real-time collaboration).

## Model

- Collections: `tasks`, `projects`, `tags`. An entity is an opaque JSON
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

## Client responsibilities

- Track per-entity `base_rev` (server rev last seen) and a dirty set
  for local edits; debounce pushes, pull on reconnect/focus.
- Persist the pull cursor (`rev`) per account.
- Local edits to an entity that later arrives in a pull: the local
  dirty version wins and is pushed next (client already knows its
  base_rev; if the server moved meanwhile the push conflicts and
  server-wins applies).

## Out of scope for v1

- Binary attachment blobs (metadata syncs inside `data`; blobs stay
  local to each device). Future: content-addressed `PUT/GET /api/blobs/<hash>`.
- Real-time push to clients (poll on focus/interval instead).
- Field-level merge and multi-user/shared lists.
