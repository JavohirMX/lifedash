# LifeDash - Task App Spec

**Status:** Active | **Last updated:** 2026-10-20 (evening)

Scope: the centralized task app, plus the data model habits, goals, notes and
the journal build on. Single user. Local-first.

Phases 1-3 of the roadmap are shipped; where this spec and the code disagree,
the code wins. Phase tags below mark what has landed.

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
  note:          plain-text mirror of noteDoc, used by search
  noteDoc:       ProseMirror JSON | null   (null = plain/empty)
  projectId:     uuid               ('inbox' = Inbox)
  parentId:      uuid | null        (set for subtasks)
  goalId:        uuid | null        (linked goal)
  noteId:        uuid | null        (note this task was extracted from)
  status:        active | done | archived
  pinned:        bool
  priority:      0 none | 1 high | 2 medium | 3 low
  dueDate:       date | null        (null = backlog)
  dueTime:       'HH:MM' | null     (null = anytime)
  recurrence:    rrule string | null
  blockedBy:     uuid[]
  tags:          string[]           (lowercase, no '#')
  order:         number             (fractional manual sort within a list)
  seriesId:      uuid | null        (links recurring occurrences)
  createdAt / updatedAt / completedAt: timestamps
}

Goal { id, title, targetDate: date | null, status: active | done | archived, order }
Habit { id, name, color, weekdays: number[] | null (null = daily), order, archived }
HabitLog { id: '<habitId>:<date>', habitId, date, doneAt }   (idempotent per day)
Note { id, title, note (plain-text mirror), noteDoc, pinned, createdAt, updatedAt }
JournalEntry { id, date (one per day), note, noteDoc, mood: 1-5 | null }

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
| **Home** | Today's summary, a suggested next task, habit and goal widgets. |
| **Today** | Due today + overdue, pinned first, then manual order. |
| **Upcoming** | Grouped by date, next 14 days. |
| **Backlog** | All no-date tasks; drag or "Today" button to schedule. |
| **Planner** | Hourly timeline of today; drag or tap to schedule tasks. |
| **Week** | Seven columns with overdue strip and week navigation. |
| **Calendar** | Month grid; click a day to drill in. |
| **Habits** | Streaks, completion rate, week grid with per-day toggles. |
| **Goals** | Progress bars over linked tasks, target dates. |
| **Notes** | Rich-text notes with pinning and filtering. |
| **Journal** | One entry per day with mood and jump-to-date. |
| **Project** | Tasks in one project, subtasks nested, progress bar. |
| **Inbox** | Default project for unsorted capture. |
| **Completed** | Grouped by completion day with counts. |
| **Search** | Global across tasks, notes, journal and goals, with scopes. |

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

### Dependencies (shipped)
- "Blocked by" picker on a task.
- A blocked task is shown greyed with the blocker named; completing it while
  blocked asks for confirmation.
- No cycle: picking a blocker that would create a loop is refused.

### Rich text + checklists (shipped)
- Notes support bold/italic, bullet and numbered lists, links, and checkbox
  lists. Stored as structured JSON (ProseMirror document).

### Media (shipped)
- Attach images/files from device; stored locally, synced later.
- Images show a thumbnail in the task detail.

### Backlog (shipped)
- No-date tasks live here. Drag (or long-press menu on touch) onto a day.

### Suggestions (first version shipped on Home)
- Suggested next task from deadlines, pinning and order.
- Honest heuristics only; no fake intelligence claims.

### Automation (first rules shipped)
- Shipped rules: roll overdue tasks into Today; complete a parent task when
  its subtasks finish. Both are user toggles in the Automation dialog.
- User rules (tag or weekly trigger) create a task and can set its project
  and pinned state; unset fields keep the defaults (inherited project or
  Inbox, unpinned).

## 5. Non-functional requirements

- **Offline-first:** every feature works with no network. Sync (Phase 4) is an
  add-on, never a dependency.
- **Fast:** cold start to interactive under 1.5s on a mid-range phone.
- **One user:** no accounts, no auth in the local app.
- **Own your data:** everything in an open local store; export to JSON/Markdown
  at any time (MVP: JSON export).
- **Timezone-aware:** dates and recurrence honor the device timezone
  (Asia/Makassar default), correct across travel.

## 6. Explicitly out of scope

- Collaboration, sharing, comments
- Notifications (Phase 4)
- TV surface (Phase 5)
- Calendar integration

(Sync between devices shipped as a Phase 4 add-on; the app never requires it.
Habits, goals, notes, journal and the day planner shipped in Phase 3.)
