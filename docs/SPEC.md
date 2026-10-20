# LifeDash - Task App Spec

**Status:** Active | **Last updated:** 2026-10-20

Scope: the centralized task app (Phases 1-2 of the roadmap), plus the data model
habits and the day planner will build on. Single user. Local-first.

## 1. Concepts

| Concept | Meaning |
|---------|---------|
| **Task** | One thing to do. Has a title, optional note, optional due date, status. |
| **Subtask** | A checklist item belonging to a task. One level deep in MVP. |
| **Project** | A named grouping of tasks, with its own color and view. |
| **Pin** | A pinned task floats to the top of every list it appears in. |
| **Recurrence** | A rule that regenerates the task when completed (or when the date passes). |
| **Backlog** | Tasks with no date: the parking lot. |
| **Dependency** | Task A blocked-by task B: A warns/stays gated until B completes. |
| **Habit** | A repeating daily/weekly practice tracked for streaks (Phase 3). |

## 2. Data model (MVP)

```
Task {
  id:            uuid
  title:         string (required)
  note:          rich text (Phase 2; plain string in MVP)
  projectId:     uuid | null        (null = Inbox)
  parentId:      uuid | null        (set for subtasks)
  status:        active | done | archived
  pinned:        bool
  dueDate:       date | null        (null = backlog)
  dueTime:       time | null
  recurrence:    rrule string | null
  blockedBy:     uuid[]             (Phase 2)
  order:         number             (manual sort within a list)
  createdAt / updatedAt / completedAt: timestamps
}

Project {
  id: uuid
  name: string
  color: string
  order: number
  archived: bool
}
```

Media attachments (Phase 2) hang off Task as `Attachment { id, taskId, kind,
blob, caption }`, stored locally alongside the task data.

## 3. Views (MVP)

| View | Contents |
|------|----------|
| **Today** | Due today + overdue, pinned first, then manual order. |
| **Upcoming** | Grouped by date, next 14 days. |
| **Backlog** | All no-date tasks, drag into Today to schedule. |
| **Project** | Tasks in one project, subtasks nested. |
| **Inbox** | Default project for unsorted capture. |
| **Completed log** | What was done, when (simple reverse-chron list). |

Every list: pinned tasks on top, clearly marked.

## 4. Feature behavior

### Capture
- One-tap/quick-add from anywhere: title only, lands in Inbox, details later.
- Enter creates the task and keeps the input open for the next one.

### Subtasks
- Shown nested under the parent, with their own checkboxes.
- Parent shows progress (2/5). Completing a parent asks what to do with open
  subtasks (complete them too / leave them).

### Recurring tasks
- Rules: daily, weekly (pick weekdays), monthly (pick day), every N days.
- Completing a recurring task spawns the next occurrence at the next date;
  the completion is recorded.
- Skipping is explicit, so streak-ish history stays honest.

### Pinning
- Pin/unpin from the task row. Pinned tasks sort above unpinned within any
  view, then by manual order.

### Dependencies (Phase 2)
- "Blocked by" picker on a task.
- A blocked task is shown greyed with the blocker named; completing it while
  blocked asks for confirmation.
- No cycle: picking a blocker that would create a loop is refused.

### Rich text + checklists (Phase 2)
- Notes support bold/italic, bullet and numbered lists, links, and checkbox
  lists. Stored as structured JSON (ProseMirror document).

### Media (Phase 2)
- Attach images/files from device; stored locally, synced later.
- Images show a thumbnail in the task detail.

### Backlog (Phase 2 view polish; basic version in MVP)
- No-date tasks live here. Drag (or long-press menu on touch) onto a day.

### Suggestions (Phase 5)
- "Up next" strip: overdue, due soon, stale backlog items, broken recurrence.
- Honest heuristics only; no fake intelligence claims.

### Automation (Phase 5)
- Simple rules: trigger (task completes, date arrives) -> action (create task,
  move to project, pin). User-defined, visible and editable in one place.

## 5. Non-functional requirements

- **Offline-first:** every feature works with no network. Sync (Phase 4) is an
  add-on, never a dependency.
- **Fast:** cold start to interactive under 1.5s on a mid-range phone.
- **One user:** no accounts, no auth in the local app.
- **Own your data:** everything in an open local store; export to JSON/Markdown
  at any time (MVP: JSON export).
- **Timezone-aware:** dates and recurrence honor the device timezone
  (Asia/Makassar default), correct across travel.

## 6. Explicitly not in MVP

- Collaboration, sharing, comments
- Sync between devices
- Notifications
- Habits, day planner, TV surface (own phases)
- Calendar integration
