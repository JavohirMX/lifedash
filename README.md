# LifeDash

A whole-life dashboard and centralized task app: tasks, projects, habits and a
day planner in one place, on web, desktop and mobile.

**Status:** early development. Single-user, local-first.

## Self-host

From the repository root, run `make setup` for a guided Docker Compose setup
(Python 3 and make required). It checks Docker/Compose/config, explains the
network exposure and asks before building or starting services.
`make setup-check` only runs the read-only preflight. It never starts services.
The helper pins the root Compose file (ignores `COMPOSE_FILE` and implicit
overrides), but your Docker context and `COMPOSE_PROJECT_NAME` still apply.
Confirm the intended host/project before consenting: existing services may be
recreated. Custom override stacks should use manual Compose. Its health check
runs inside the selected sync container, not an unrelated service on a host port.

Or start directly with Docker Compose:

    docker compose up --build

App on http://localhost:8080, sync server on http://localhost:8787.
Open the bundled setup checklist at `http://localhost:8080/selfhost.html`
(or use the setup-guide link in Settings). It walks through first-account setup,
HTTPS/device URLs, sync limits and backups without contacting another service.

Details and other deployment options: [server/SELFHOST.md](server/SELFHOST.md).

## Local development

Run `make install` once to install npm dependencies and a server virtual
environment, including test dependencies. Then `make dev` starts the app on
Vite's local URL and the sync server on http://127.0.0.1:8787. Ctrl-C stops
both. `make test` runs both suites; `make build` builds the frontend.
`make help` lists individual app/server and Docker targets. Python 3 with
venv support, Node/npm and make are required. Docker targets additionally
need Docker Engine and the Compose plugin.

`make test-keyboard` starts a temporary loopback Vite server and runs the
sample-only desktop/phone keyboard checks for dialogs, Appearance, the command
palette, mobile navigation and Export. It needs an installed Chrome/Chromium;
set `CHROME_PATH` if it is not `/usr/bin/google-chrome`. No real user database,
sync account or AI provider is used. The server stops when checks finish or are
interrupted. The default port is 4174; use `KEYBOARD_TEST_PORT` to choose another
free port. An occupied port fails rather than using an existing server.

`make test-selfhost` runs a disposable loopback API check for restart persistence
and SQLite online backup/restore. It uses synthetic temporary databases only.
It requires the installed server venv and a POSIX host; it does not test Docker,
TLS, a reverse proxy or real-device sync.

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
