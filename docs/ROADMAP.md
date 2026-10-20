# LifeDash - Roadmap

**Status:** Active | **Last updated:** 2026-10-20 (evening)

## Direction

LifeDash is now a **whole-life dashboard built around a centralized task app**:
tasks, projects, habits and a day planner in one system, available on web,
desktop (macOS, Windows, Linux) and mobile (iOS, Android).

This supersedes the original TV-only concept (July 2026 PRD/TRD set, since
removed from the tree; still in git history). The TV dashboard remains a goal,
reframed as a read-only surface on top of LifeDash data (Phase 5).

## Phases

### Phase 0 - Spec and roadmap (done with this document)

- Product spec for the task app: [SPEC.md](SPEC.md)
- Stack decision: [ARCHITECTURE.md](ARCHITECTURE.md)

### Phase 1 - Task core (MVP, local-first web app) - SHIPPED

- Tasks: create, edit, complete, delete, reorder
- Subtasks (nested checklists on a task)
- Projects (grouping, per-project views, per-project settings and progress)
- Pinned tasks (always on top)
- Recurring tasks (daily / weekly / monthly / custom interval)
- Today view, Upcoming view, project views
- Local persistence (IndexedDB), installable PWA
- Offline-first: full function without a network

### Phase 2 - Task depth - SHIPPED

- Rich-text notes on tasks (TipTap: bold, lists, links, headings)
- Checklists inside notes
- Media attachments on tasks
- Backlog view (no-date parking lot, drag into Today)
- Task dependencies (blocked-by relationships, with warnings)
- Global search and filters (by project, date, status, tag) plus command palette
- Tags/labels, priorities, natural-language quick add

### Phase 3 - Habits + day planner - SHIPPED

- Habits module: daily/weekly habits, streaks, completion grid (per-day toggles)
- Day planner: timeline view of a day, drag or tap to schedule into time blocks
- Week view with overdue strip and week navigation; calendar month view
- Also landed here: goals, rich-text notes module, journal, completed view,
  import (Todoist CSV, generic CSV, Obsidian Markdown, LifeDash JSON),
  JSON export/restore

### Phase 4 - Everywhere - IN PROGRESS

- Sync backend (self-hosted, single user) so devices share state - SHIPPED:
  FastAPI + SQLite server (`server/`), Docker image, offline-queued web client
- Desktop builds via Tauri (macOS, Windows, Linux)
- Mobile builds via Capacitor (iOS, Android)
- Notifications/reminders per platform

### Phase 5 - Surfaces and smarts - IN PROGRESS

- TV dashboard surface (the original July vision: glanceable, kiosk) reading
  LifeDash data
- Suggestions (what to do next, based on deadlines, recurrence, history) -
  first version shipped on Home
- Automation rules - first rules shipped (roll overdue into Today; complete a
  parent when its subtasks finish); more rules to come

## Working agreements

- All work lands as pull requests from the `devmjxio` account; the owner merges.
- Nothing is pushed to `main` directly.
- Every UI phase ships with real-browser screenshots (desktop + mobile width).
- Unverified claims are called out in the PR, not smoothed over.
