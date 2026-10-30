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
  `tasks projects habits habitLogs goals notes journal focusSessions`.
  Tombstones keep their last payload in `data`, so nothing is lost.
- `GET /api/agent/entities/{collection}/{id}` -> one entity, including
  tombstones (soft-deleted entities return `deleted: true`).

## Writes (read-write scope)

All writes apply the app's own invariants and become normal sync changes:
every connected device picks them up on its next pull. All deletes are
tombstones; nothing is permanently removed.

- `POST /api/agent/tasks` `{title, projectId?, parentId?, goalId?, noteId?,
  dueDate?, dueTime?, priority?, recurrence?, tags?}` -> the created task.
  Defaults to the Inbox project; `order` is appended per project; tags are
  normalized like the app; `recurrence` must be an RRULE that can actually
  be evaluated (a DTSTART is recommended; rules without one work but anchor
  at the rule's creation time).
- `POST /api/agent/tasks/{id}/complete` `{today?}` -> completes and, for a
  recurring task, spawns the next occurrence exactly like the app (next date
  strictly after max(due, today), monthly rules clamp short months, undo
  keeps the spawned occurrence). `today` is the user's local date; it
  defaults to the server's local date, so agents in another timezone should
  pass it explicitly. Completing twice is a no-op, never a duplicate spawn.
- `POST /api/agent/tasks/{id}/uncomplete`, `POST /api/agent/tasks/{id}/skip`
  -> mirror the app's undo and skip (skip records the skipped date).
- `PATCH /api/agent/tasks/{id}` -> partial update. Fields absent stay
  untouched; explicit `null` clears the nullable-by-design fields (dates,
  times, `parentId`, `goalId`, `durationMinutes`, `recurrence`) and is
  rejected (422) for the rest. References are validated; dependency cycles
  and self/descendant parenting are refused. `status` accepts `archived`
  and `active` (un-archive) - use complete/uncomplete for `done`.
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
- `DELETE /api/agent/entities/{collection}/{id}` -> soft delete with
  cascades: deleting a task removes its subtasks at every depth and strips
  dead dependency references; deleting a project removes its own tasks and
  moves subprojects up one level (they stay intact); deleting a note
  unlinks its extracted tasks. The Inbox project cannot be deleted.
  Tombstoned rows keep their full payload on the server.
- `POST /api/agent/entities/{collection}/{id}/restore` -> undelete.
  Entities removed by the same delete cascade come back with it.
  Reference rewrites done during the delete (stripped `blockedBy`, dropped
  `noteId`, reparented subprojects) are not reversed; restore recovers the
  entities, not the exact prior graph. Restoring a live entity is a 409.
  Restore refuses to create invalid state (409): a tombstone without a
  preserved payload, an orphan whose container (project, parent task,
  parent project, habit) is still deleted, or a journal entry whose date a
  live entry already has.

## Project-scoped keys

A key can be confined to one project (`projectId` at creation; shown in
the key list). The boundary:

- **In scope:** tasks, focus sessions and attachments in the project AND
  its subprojects, recursively. Out-of-scope entities are invisible (404).
- **Read-only, subtree only:** the key sees its own project subtree, never
  other projects' names. It cannot create, patch or delete projects.
- **Out of reach (403):** habits, goals, notes and journal - they are
  account-wide, not owned by any one project, so a scoped key cannot read
  or write them at all, nor link tasks to them (`goalId`/`noteId`).
- Task references (`parentId`, `blockedBy`) must point inside the subtree;
  out-of-scope targets look like they do not exist (404).
- Scoped keys cannot create tasks in the Inbox (it is outside every
  project) or move a task out of the subtree.
- Deletes are refused whole (409) when their cascade or reference cleanup
  would touch anything outside the subtree. Restores skip out-of-scope
  cascade members and report only a count in `skippedOutOfScope` - their
  ids never cross the boundary.
- `read` vs `read-write` still applies on top: a read+scoped key gets 403
  on every write, even inside its project.
- `POST /api/agent/focus-sessions` `{taskId, startedAt, endedAt, seconds}`
  -> log a COMPLETED focus session (live timers stay on the device). Dates
  are validated: endedAt after startedAt, seconds within the span, no
  far-past or future timestamps.

## Validation rules worth knowing

- `color` fields are hex colors (`#0f766e`).
- Habit `weekdays` are strict integers 0-6 (0=Sun), distinct, or null for
  every day - booleans and floats are rejected.
- Every mutating route requires a read-write key; a read-only key gets 403
  even when the request body is invalid.

## References to deleted entities

Deleting a goal leaves `goalId` on its tasks, and deleting a habit leaves
it in goals' `habitIds`, exactly like the app. This is deliberate: the
referenced rows still exist as recoverable tombstones, and stripping the
references would destroy information a restore needs.

## Attachments

Attachment metadata is a normal synced entity; the bytes live on the
server's disk:

- `POST /api/attachments?task_id=&filename=` (raw request body) -> the
  metadata (`{id, taskId, name, mime, byteSize, sha256, createdAt,
  blobOnServer}`) plus `rev`. The app's session token or an agent key both
  work; scoped keys follow the task's boundary. An optional `id` parameter
  lets the app upload under its local row id so both sides converge;
  re-uploading the same id with the same bytes returns the existing
  entity (retry-safe), with different bytes it is a 409. Ids must be plain
  safe filenames - anything else (`.`, `..`, separators) is refused on
  every blob route.
- `GET /api/attachments/{id}/content` -> the bytes, always served with
  `Content-Disposition: attachment` and `X-Content-Type-Options:
  nosniff` so stored files never render as active content.
- `DELETE /api/attachments/{id}` -> soft delete; the blob is retained so
  restore recovers the whole attachment. Deleting a task tombstones its
  attachments with the same cascade.
- Quotas are deliberate defaults the operator can tune:
  `SYNC_ATTACHMENT_QUOTA_MB` (200 MB per account, measured from the blob
  files actually on disk - retained deleted blobs included, client-claimed
  `byteSize` metadata never counts) and `SYNC_ATTACHMENT_MAX_FILE_MB`
  (25 MB per file, enforced while streaming, not by trusting
  Content-Length). A failed upload never leaves an orphaned blob behind.
- The app keeps blobs in its local database and uploads them through this
  endpoint (best-effort on attach, backfilled on sync); attachment rows
  synced without their blob are downloaded from
  `/api/attachments/{id}/content` on demand. Blobs never ride the JSON
  sync protocol.

## Automation configuration

The app's automation config (Settings toggles and user-defined rules) is
synced, so agents manage ONE configuration shared by every device:

- `GET /api/agent/settings/automation` / `PUT /api/agent/settings/automation`
  - the `rollover` and `completeParent` toggles; partial updates merge,
    unknown fields and non-booleans are 422.
- `POST /api/agent/user-rules` / `PATCH /api/agent/user-rules/{id}` plus the
  generic list/get/delete/restore endpoints - rules shaped like the app's
  own model: `{trigger: {kind: "tag", tag}}` or
  `{trigger: {kind: "weekly", weekday: 0-6}}`, a non-empty `title`, and
  `lastFired` (YYYY-MM-DD or null).

Rules still EXECUTE only in the app while Lifedash is open; the API manages
their configuration. Project-scoped keys get 403 - automation config is
account-wide.

## Per-device settings

Appearance and reminder preferences are PER DEVICE, and agents may manage
them on a specific device (product decision, Oct 29). Each device mirrors its
own six preferences into a `deviceSettings` entity keyed by its stable
device id; the device keeps a localStorage cache for synchronous boot and
applies remote changes on its next sync pull:

- `GET /api/agent/devices` - every known device: `deviceId`, `label`
  (e.g. "Chrome on Linux"), `updatedAt`, and its `settings`.
- `GET /api/agent/devices/{deviceId}/settings` - one device; 404 when the
  id is unknown, 422 for a malformed id.
- `PUT /api/agent/devices/{deviceId}/settings` - partial update, merged
  like automation config. Validated fields:
  `theme` (light|dark|system), `style` (paper|terminal|editorial|soft|
  contrast|nexus|compact|polar), `font` (style|inter|manrope|geist|
  source-sans|dm-sans|plex|system|serif|mono),
  `wallpaper` (`{id: none|aurora|sand|blue|custom, intensity: 0-35}`),
  `remindersEnabled`, `journalPromptEnabled`. Unknown fields and wrong
  types are 422. Custom wallpaper IMAGES never ride sync - set `custom`
  and the device keeps its own image; sending `image` is a 422.

Changes take effect when the target device next syncs (usually seconds
while it is open). Project-scoped keys get 403 - device settings are
account-wide.

Deleting a device's row (generic DELETE on `deviceSettings`) is sticky:
the device cannot re-register by re-pushing - its pushes conflict and the
server keeps the tombstone until an explicit `POST
/api/agent/entities/deviceSettings/{id}/restore` revives it with its
payload. This is deliberate: soft delete means soft delete.

Raw vs typed reads: the typed device endpoints above normalize what they
relay - invalid enum/wallpaper/bool values are omitted and labels are
bounded strings. The GENERIC entity endpoints (`/api/agent/entities/...`)
return the row exactly as the owning account's clients pushed it, like
every collection: a buggy or hand-rolled client of the same account can
store an oversized label or a wallpaper.image blob, and the generic API
will return it. The app itself never publishes the custom image (only the
id+intensity), and the typed settings PUT rejects an `image` field - but
an agent reading generic entities can see whatever its own account
uploaded.

## Project-scoped keys

A key scoped to one project sees only that project's subtree: tasks,
focus sessions and attachments inside it, and the project tree itself
(read-only context). Account-wide collections (habits, goals, notes,
journal, automation config) are 403. Out-of-scope entities are 404 -
the API never reveals whether they exist.

Scoped keys CAN manage the inside of their subtree: create projects
under it (a parentId inside the subtree is required), rename, recolor,
archive and move projects within it. The key's root project is shared
context and read-only; moving anything out of the subtree, creating
top-level projects, and deleting projects stay refused (403/422 with
the same shape as ordinary validation errors, no scope oracle).

## What the API deliberately does not do

- **No permanent delete.** Tombstones keep their full payload and are
  restorable through the API (Owner decision, Oct 29). Client sync
  tombstones keep the server copy too: a device dropping its local copy
  never destroys the only record.
- **No raw entity writes.** The sync push endpoint stays reserved for real
  clients; agents use the validated operations above so recurrence, habit
  and journal invariants cannot be corrupted.
- **No rich-text document editing.** ProseMirror `noteDoc` content is
  preserved and readable, but only editable in the app.
- **Local-only data stays local**: attachment blobs (never sync),
  custom wallpaper images, and live focus timers. Device appearance and
  reminder settings DO sync per device (above); automation config syncs
  account-wide. API completions do not fire device-local automation
  rules; the devices apply their own rules as usual. Focus session
  history syncs; only live timers stay on the device.

## Transport security

The server has no TLS of its own; keys are bearer credentials. Run agents
against it only on the machine itself (`http://127.0.0.1`) or behind a
TLS-terminating reverse proxy you trust. Do not expose the plain HTTP port
to a network you do not control.
