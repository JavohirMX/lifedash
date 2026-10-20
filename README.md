# LifeDash

A whole-life dashboard built around a centralized task app: tasks, projects,
habits, goals, notes, a journal and a day planner in one place. Local-first
and installable as a PWA on desktop and mobile; an optional self-hosted sync
server keeps devices in step.

Single user, in active development.

## Screenshots

| Home | Week |
|---|---|
| ![Home](shots/combined-home.png) | ![Week](shots/week-nav-overdue.png) |

| Habits | Completed (mobile) |
|---|---|
| ![Habits](shots/habits-past-toggle.png) | ![Completed](shots/completed-groups-mobile.png) |

More UI screenshots live in [`shots/`](shots/).

## Features

**Tasks**
- Create, edit, complete, reorder (drag-and-drop on desktop, long-press on touch)
- Subtasks, pinned tasks, priorities, tags, due dates and times
- Rich-text task notes (TipTap: headings, lists, links, checklists) with media attachments
- Recurring tasks (rrule: daily, weekly, monthly, every N days)
- Dependencies: blocked-by relationships with warnings and cycle prevention
- Natural-language quick add ("Call Sam tomorrow 9am #personal")

**Views**
- Home: what matters now, with a suggested next task
- Today: due today plus overdue; Upcoming: next 14 days grouped by day
- Backlog: no-date parking lot, pull tasks into Today
- Completed: grouped by completion day with counts
- Week: seven columns, overdue strip, previous/next week navigation
- Calendar: month grid with day drill-down
- Planner: hourly timeline, drag tasks into time blocks or tap to schedule on touch
- Projects with colors and per-project progress; Inbox for unsorted capture

**Beyond tasks**
- Goals: link tasks, track progress, set target dates
- Habits: daily or chosen weekdays, streaks, completion rate, week grid with per-day toggles
- Notes: rich text with pinning, filtering and one-click "checklist to tasks"
- Journal: one entry per day with mood and jump-to-date
- Global search across tasks, notes, journal and goals; command palette and keyboard shortcuts

**Data**
- Local-first: IndexedDB (Dexie); the app fully works offline
- Import from Todoist CSV, generic CSV, Obsidian Markdown and LifeDash JSON
- Export a full JSON backup and restore it
- Optional self-hosted sync (FastAPI + SQLite, see `server/`) with offline queue
- Automation rules: roll overdue tasks into Today; complete a parent when its subtasks finish
- Light, dark or system theme

## Quickstart

The app (`app/`) - needs Node 20+:

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

The sync server (`server/`, optional) - needs Python 3.11+:

```bash
cd server
pip install -r requirements-dev.txt
SYNC_DB=./dev.db SYNC_OPEN_REGISTRATION=1 uvicorn app.main:app --port 8787
```

Or with Docker: `cd server && docker compose up -d --build`.

## Tests

```bash
cd app && npm test          # 86 unit tests (Vitest)
cd app && npm run build     # type-check (tsc) + production build
cd server && pytest         # 15 tests
```

CI runs both suites on every push to `main` and every PR
(`.github/workflows/ci.yml`).

## Configuration

The app needs no configuration. To enable sync, open the Sync dialog in the
app and point it at your server URL and account.

Server environment variables:

| Variable | Default | Purpose |
|---|---|---|
| `SYNC_DB` | `./lifedash.db` | SQLite database path |
| `SYNC_OPEN_REGISTRATION` | unset | `1` keeps account registration open; otherwise it closes after the first user |

## Deploy

- **App:** `cd app && npm run build` produces a static `dist/` you can host
  anywhere. Serve over HTTPS for install prompts and the service worker.
- **Server:** Docker (see above) or a bare-metal Python process behind a TLS
  reverse proxy. Full guide: [`server/SELFHOST.md`](server/SELFHOST.md).

## Project structure

```
app/      React + TypeScript + Vite PWA (Dexie, TipTap, rrule)
server/   FastAPI + SQLite sync server (Dockerfile, compose, self-host guide)
docs/     SPEC.md, ROADMAP.md, ARCHITECTURE.md
shots/    real-browser screenshots referenced by PRs
```

## License

Not yet chosen.
