# LifeDash - Roadmap

**Status:** Active | **Last updated:** 2026-10-20

## Direction

LifeDash is now a **whole-life dashboard built around a centralized task app**:
tasks, projects, habits and a day planner in one system, available on web,
desktop (macOS, Windows, Linux) and mobile (iOS, Android).

This supersedes the original TV-only concept (`01-PRD.md` - `06-ImplPlan.md`,
July 2026). Those docs are kept: the TV dashboard remains a goal, reframed as a
read-only surface on top of LifeDash data (Phase 5).

## Phases

### Phase 0 - Spec and roadmap (done with this document)

- Product spec for the task app: [SPEC.md](SPEC.md)
- Stack decision: [ARCHITECTURE.md](ARCHITECTURE.md)

### Phase 1 - Task core (MVP, local-first web app)

The smallest version that is genuinely useful as a daily todo app.

- Tasks: create, edit, complete, delete, reorder
- Subtasks (nested checklists on a task)
- Projects (grouping, per-project views)
- Pinned tasks (always on top)
- Recurring tasks (daily / weekly / monthly / custom interval)
- Today view, Upcoming view, project views
- Local persistence (IndexedDB), installable PWA
- Offline-first: full function without a network

Exit gate: usable as the daily driver for personal tasks in a browser, verified
in a real browser with screenshots.

### Phase 2 - Task depth

- Rich-text notes on tasks (bold, lists, links)
- Checklists inside notes
- Media attachments on tasks
- Backlog view (no-date parking lot, drag into Today)
- Task dependencies (blocked-by relationships, with warnings)
- Global search and filters (by project, date, status, tag)
- Tags/labels

### Phase 3 - Habits + day planner

- Habits module: daily/weekly habits, streaks, completion grid
- Day planner: timeline view of a day, drag tasks into time blocks
- Week view
- Absorb what the July docs wanted from Hermes/Obsidian into native features
  (import path TBD when we get here)

### Phase 4 - Everywhere

- Sync backend (self-hosted, single user) so devices share state
- Desktop builds via Tauri (macOS, Windows, Linux)
- Mobile builds via Capacitor (iOS, Android)
- Notifications/reminders per platform

### Phase 5 - Surfaces and smarts

- TV dashboard surface (the original July vision: glanceable, kiosk, Nexus
  palette) reading LifeDash data
- Suggestions (what to do next, based on deadlines, recurrence, history)
- Automation rules (e.g. "when X completes, create Y", "every Friday, surface
  backlog")

## Working agreements

- All work lands as pull requests from the `devmjxio` account; the owner merges.
- Nothing is pushed to `main` directly.
- Every UI phase ships with real-browser screenshots (desktop + mobile width).
- Unverified claims are called out in the PR, not smoothed over.
