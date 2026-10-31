# Lifedash

**Your whole life in one dashboard.** Tasks, projects, habits, goals, notes,
a journal and a day planner in one place. Local-first and installable as a
PWA on desktop and mobile; an optional self-hosted sync server keeps your
devices in step.

[![CI](https://github.com/JavohirMX/lifedash/actions/workflows/ci.yml/badge.svg)](https://github.com/JavohirMX/lifedash/actions/workflows/ci.yml)

| Home | Week (dark) |
|---|---|
| ![Home](shots/combined-home.png) | ![Week](shots/week-nav-overdue.png) |

| Habits | Home (mobile) |
|---|---|
| ![Habits](shots/habits-past-toggle.png) | ![Home on mobile](shots/home-mobile.png) |

More UI screenshots live in [`shots/`](shots/).

## Why Lifedash

- **Local-first.** Everything lives in your browser's IndexedDB and works
  fully offline. No account is needed to use the app.
- **Everything in one place.** Tasks, subtasks, projects, habits, goals,
  rich-text notes, a daily journal and an hourly planner share one home.
- **Yours to host.** The optional sync server is a small FastAPI + SQLite
  service you run yourself - one Docker Compose file, no external services.

## Features

**Tasks**
- Create, edit, complete, reorder (drag-and-drop on desktop, long-press on touch)
- Subtasks, pinned tasks, priorities, tags, due dates and times
- Rich-text task notes (TipTap: headings, lists, links, checklists) with media attachments
- Recurring tasks (rrule: daily, weekly, monthly, every N days)
- Dependencies: blocked-by relationships with warnings and cycle prevention
- Natural-language quick add ("Call Sam tomorrow 9am #personal")

**Views**
- Home: what matters now, with a suggested next action
- Today: due today plus overdue; Upcoming: next 14 days grouped by day
- Backlog: no-date parking lot, pull tasks into Today
- Completed: grouped by completion day with counts
- Week: seven columns with an overdue strip; Calendar: month grid with day drill-down
- Planner: hourly timeline, drag tasks into time blocks or tap to schedule on touch
- Projects with colors and per-project progress; Inbox for unsorted capture

**Beyond tasks**
- Goals: link tasks, track progress, set target dates
- Habits: daily or chosen weekdays, streaks, completion rate, week grid with per-day toggles
- Notes: rich text with pinning, filtering and one-click "checklist to tasks"
- Journal: one entry per day with mood and jump-to-date
- Global search across tasks, notes, journal and goals; command palette and keyboard shortcuts

**Data and appearance**
- Import from Todoist CSV, generic CSV, Obsidian Markdown and Lifedash JSON;
  export and restore a full JSON backup
- Optional self-hosted sync (FastAPI + SQLite, see `server/`) with an offline queue
- Automation rules: roll overdue tasks into Today; complete a parent when its subtasks finish
- 16 selectable visual styles, each in light and dark; system theme respected

## Quick start

The app (`app/`) needs Node 20+:

```bash
cd app
npm install
npm run dev        # http://localhost:5173
```

Want a tour with fictional data? Open `http://localhost:5173/?sample` - a
clearly marked sandbox that never touches your real database or sync account.

The sync server (`server/`, optional) needs Python 3.11+:

```bash
cd server
pip install -r requirements-dev.txt
SYNC_DB=./dev.db SYNC_OPEN_REGISTRATION=1 uvicorn app.main:app --port 8787 --no-proxy-headers
```

## Self-host with Docker

From the repository root:

```bash
docker compose up --build
```

App on http://localhost:8080, sync server on http://localhost:8787. Then open
the bundled setup checklist at `http://localhost:8080/selfhost.html` - it walks
through the first account, HTTPS and device URLs, sync limits and backups.
Prefer a guided start? `make setup` runs the same checks interactively and asks
before starting anything; `make setup-check` is the read-only preflight.

Put TLS in front before leaving localhost (the guide shows Caddy and Tailscale
Funnel). Full deployment options: [server/SELFHOST.md](server/SELFHOST.md).

> **Know before you restore:** restoring an *older* server backup can silently
> corrupt multi-device sync (devices miss later changes). The cautious manual
> path is documented in [server/SELFHOST.md](server/SELFHOST.md) - read it
> before restoring anything. Day-to-day backups are unaffected.

## Documentation

- [server/SELFHOST.md](server/SELFHOST.md) - full self-host guide: deploy, TLS, backups, recovery
- [docs/self-host-hardening.md](docs/self-host-hardening.md) - limits, proxy/CORS settings, server environment variables
- [docs/SPEC.md](docs/SPEC.md) - product spec · [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - technical design · [docs/ROADMAP.md](docs/ROADMAP.md) - plans

## Development

```bash
make install   # one-time: npm deps + server venv with test deps
make dev       # app (Vite) + sync server together; Ctrl-C stops both
make test      # app unit tests + server tests
make build     # production build of the app (app/dist)
make help      # everything else (Docker, keyboard checks, self-host smoke)
```

Requires Python 3 with venv, Node/npm and make; Docker targets additionally
need Docker Engine with the Compose plugin. CI runs both test suites and the
production build on every push to `main` and every PR.

Server configuration lives in environment variables; the two you will meet
first are `SYNC_DB` (SQLite path, default `/data/lifedash.db`) and
`SYNC_OPEN_REGISTRATION` (`1` keeps registration open; otherwise it closes
after the first account). The full table with limits and defaults is in
[docs/self-host-hardening.md](docs/self-host-hardening.md).

## Project structure

```
app/      React + TypeScript + Vite PWA (Dexie, TipTap, rrule)
server/   FastAPI + SQLite sync server (Dockerfile, compose, self-host guide)
docs/     spec, architecture, roadmap, hardening reference
shots/    real-browser screenshots referenced by the README and PRs
```

## Status

In active development. The app is offline-capable and covered by unit and
real-browser checks; the sync server is aimed at self-hosters comfortable
running a small service. Calendar exchange is manual ICS export/import; a
provider integration is being explored but is not included.

## License

Not yet chosen.
