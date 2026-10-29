# Lifedash agent API (v1)

Lets AI agents read and change Lifedash data through the self-hosted sync
server, with named, scoped, revocable keys managed in the app's Settings.
Design goals: agents can never create state the app itself would not create;
deletes are soft deletes (tombstones), never permanent; keys are shown once
and stored hashed.

## Keys

Managed with the normal session token (the same one the app uses for sync):

- `POST /api/agent-tokens` `{name, scope}` -> `{id, name, scope, token, created_at}`.
  `scope` is `read` or `read-write`. **The token is returned only here.**
  At most 25 active keys per user.
- `GET /api/agent-tokens` -> every key with `created_at` / `last_used_at` /
  `revoked_at` (never the token or its hash).
- `POST /api/agent-tokens/{id}/revoke` -> 204. Revocation is immediate.

Agents then call with `Authorization: Bearer ldk_...`. A read-only key gets
403 on every write. `last_used_at` updates on each authenticated call.
Every write is recorded in the `agent_audit` table (key, action, entity).

## Reads (any scope)

- `GET /api/agent/collections` -> per-collection live counts.
- `GET /api/agent/entities/{collection}?limit=&offset=&include_deleted=`
  -> latest state of each entity (`{id, deleted, data}`). Collections:
  `tasks projects habits habitLogs goals notes journal`.
- `GET /api/agent/entities/{collection}/{id}` -> one entity, including
  tombstones (soft-deleted entities return `deleted: true`).

## Writes (read-write scope)

All writes apply the app's own invariants and become normal sync changes:
every connected device picks them up on its next pull. All deletes are
tombstones; nothing is permanently removed.

- `POST /api/agent/tasks` `{title, projectId?, parentId?, goalId?, noteId?,
  dueDate?, dueTime?, priority?, recurrence?, tags?}` -> the created task.
  Defaults to the Inbox project; `order` is appended per project; tags are
  normalized like the app; `recurrence` must be a valid RRULE with DTSTART.
- `POST /api/agent/tasks/{id}/complete` `{today?}` -> completes and, for a
  recurring task, spawns the next occurrence exactly like the app (next date
  strictly after max(due, today), monthly rules clamp short months, undo
  keeps the spawned occurrence). `today` is the user's local date; it
  defaults to the server's local date, so agents in another timezone should
  pass it explicitly. Completing twice is a no-op, never a duplicate spawn.
- `POST /api/agent/tasks/{id}/uncomplete`, `POST /api/agent/tasks/{id}/skip`
  -> mirror the app's undo and skip (skip records the skipped date).
- `PATCH /api/agent/tasks/{id}` -> partial update. Fields absent stay
  untouched; explicit `null` clears (e.g. remove a due date). References are
  validated; dependency cycles and self/descendant parenting are refused.
  `status` only accepts `archived` - use complete/uncomplete for the rest.
  Patching `note` on a task with rich-text content is refused (409) so the
  plain-text mirror never desyncs from the rich document.
- `POST /api/agent/habits`, `PATCH /api/agent/habits/{id}` (incl. `archived`),
  `POST /api/agent/habits/{id}/check` / `uncheck` `{date}` -> check-ins are
  idempotent per day (`{habitId}:{date}`), exactly like the app.
- `POST /api/agent/projects`, `PATCH /api/agent/projects/{id}` -> nesting
  allowed, cycles refused.
- `POST /api/agent/goals`, `PATCH /api/agent/goals/{id}` (incl. `status`,
  `habitIds`, `projectIds`, all reference-validated).
- `POST /api/agent/notes`, `PATCH /api/agent/notes/{id}` -> plain text; notes
  with rich-text content refuse `note` patches (409).
- `PUT /api/agent/journal/{date}` `{note?, mood?, highlight?}` -> one entry
  per date: creates or updates. `mood` is 1-5.
- `DELETE /api/agent/entities/{collection}/{id}` -> soft delete with the
  app's cascades: deleting a task removes its subtasks and strips dead
  dependency references; deleting a project removes its own tasks and moves
  subprojects up one level (they stay intact); deleting a note unlinks its
  extracted tasks.

## What the API deliberately does not do

- **No permanent delete.** Tombstones keep the data recoverable from the
  server database and backups. (Owner decision, Oct 29.)
- **No raw entity writes.** The sync push endpoint stays reserved for real
  clients; agents use the validated operations above so recurrence, habit
  and journal invariants cannot be corrupted.
- **No rich-text document editing.** ProseMirror `noteDoc` content is
  preserved and readable, but only editable in the app.
- **Local-only data stays local**: focus sessions, attachments (blobs never
  sync), appearance/settings, and automation rules (which live per device).
  API completions do not fire device-local automation rules; the devices
  apply their own rules as usual.

## Transport security

The server has no TLS of its own; keys are bearer credentials. Run agents
against it only on the machine itself (`http://127.0.0.1`) or behind a
TLS-terminating reverse proxy you trust. Do not expose the plain HTTP port
to a network you do not control.
