# LifeDash

A whole-life dashboard and centralized task app: tasks, projects, habits and a
day planner in one place, on web, desktop and mobile.

**Status:** early development. Single-user, local-first.

## Self-host

Run the app and sync server together with Docker Compose:

    docker compose up --build

App on http://localhost:8080, sync server on http://localhost:8787.
Details and other deployment options: [server/SELFHOST.md](server/SELFHOST.md).

## Local development

Run `make install` once to install npm dependencies and a server virtual
environment, including test dependencies. Then `make dev` starts the app on
Vite's local URL and the sync server on http://127.0.0.1:8787. Ctrl-C stops
both. `make test` runs both suites; `make build` builds the frontend.
`make help` lists individual app/server and Docker targets. Python 3 with
venv support, Node/npm and make are required. Docker targets additionally
need Docker Engine and the Compose plugin.

## Docs

- [docs/ROADMAP.md](docs/ROADMAP.md) - where the project is going, phase by phase
- [docs/SPEC.md](docs/SPEC.md) - the task-app feature spec
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) - stack decision and why
- `01-PRD.md` ... `06-ImplPlan.md` - original TV-dashboard docs (July 2026),
  preserved; that concept now lives in the roadmap as the TV surface phase

## License

Not yet chosen.

## Fictional development data

Run `cd app && npm run dev`, then open `/?sample`. Development builds use a separate `lifedash-sample` IndexedDB database, seeded once with fictional tasks, projects, notes, goals, habits and journal entries. An amber banner marks the sandbox. Exit by removing `?sample`; the real `lifedash` database stays separate. Delete only `lifedash-sample` in browser storage to reset it.

Sample mode cannot read or change the saved real sync account, authenticate, revoke its token, or start manual/automatic sync. It does not block unrelated network features such as AI tools, so use only fictional content. Production builds ignore `?sample`.
