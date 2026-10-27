# Self-hosting Lifedash

The whole stack (app + sync server) runs from the repo root with:

    docker compose up --build

On the same computer, open http://localhost:8080 and, in the app, point
Settings -> Sync at http://localhost:8787. On another device, localhost means
that device, not your server; use the server's reachable HTTPS URL instead. The app is otherwise fully local - it works
without the sync server, which is only needed to share data between
devices.

The sections below cover running just the sync server (or running it
differently), which is useful if you serve the app some other way.


The sync server is a single FastAPI process with one SQLite file. No
other services, no external database. The sync process needs Python 3 and writable local storage. Check your host's
architecture and available memory before choosing a deployment.

## Pick a deployment

### Docker (recommended)

```bash
cd server
docker compose up -d --build
curl http://localhost:8787/api/health   # {"ok":true}
```

**The sync-only Compose file enables open registration by default.** After
creating your account(s), set its `SYNC_OPEN_REGISTRATION` entry to `"0"` and
run `docker compose up -d` again. The root full-stack Compose file differs: it
does not set this variable, so registration closes after the first account.

Data lives in the `lifedash-data` volume. The container listens on
`8787` and stores everything in one SQLite file at
`/data/lifedash.db`.

### Bare metal / VM

```bash
cd server
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
SYNC_DB=./lifedash.db .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8787
```

Run it under systemd (example unit below) so it restarts on boot.

```ini
# /etc/systemd/system/lifedash-sync.service
[Unit]
Description=Lifedash sync server
After=network.target

[Service]
# Create the lifedash service user and install the checkout/venv first.
# systemd creates /var/lib/lifedash, owned by User below.
StateDirectory=lifedash
WorkingDirectory=/opt/lifedash/server
Environment=SYNC_DB=/var/lib/lifedash/lifedash.db
ExecStart=/opt/lifedash/server/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8787
Restart=always
User=lifedash

[Install]
WantedBy=multi-user.target
```

## Create your account, then close registration

The current server allows the first account on an empty database without an
extra setting. After that, registration is closed unless
`SYNC_OPEN_REGISTRATION=1` is set. This is the existing server behavior, not a
new registration policy.

On a fresh installation, create your account from Settings -> Sync -> Create
account before exposing the server to other people. Treat that first-account
step as setup: anyone who can reach an empty server can create its first
account.

To add another account later, temporarily set the environment variable to
`"1"` on the **sync service**, recreate/restart it, create the account, then
remove the variable or set it to `"0"` and recreate/restart again. The root
Compose file does not set this variable by default. For the sync-only Compose
file in `server/`, edit its existing environment entry there. Do not leave
registration enabled unless you intend to allow additional accounts.

## Put TLS in front before you leave localhost

Tokens are bearer tokens - anyone who sniffs one owns the account.
Never expose plain HTTP beyond localhost. Two easy options:

**Caddy** (`Caddyfile`):

```
sync.example.com

reverse_proxy 127.0.0.1:8787
```

Caddy issues and renews the certificate automatically.

**Tailscale Funnel** (no domain, no open ports):

```bash
tailscale funnel --bg 8787
# your server is now at https://<machine>.<tailnet>.ts.net
```

## Connect the app

In Lifedash: sidebar -> **Settings** -> **Sync** -> paste the server URL
(`https://sync.example.com`) -> sign in (or create the account here
while registration is open). Sync runs on focus, on reconnect, every
5 minutes, and a few seconds after any edit. Sync now forces a round.

Every device uses the same account; each keeps its own cursor.

## Backups

Everything is one SQLite file. If your host has the SQLite CLI installed,
an online backup can be made with:

```bash
sqlite3 /data/lifedash.db ".backup '/backups/lifedash-$(date +%F).db'"
```

The container includes Python, not the SQLite command-line program. From
the repo root, use Python's online backup API and copy the result out:

```bash
docker compose exec sync python -c "import sqlite3; src=sqlite3.connect('/data/lifedash.db'); dst=sqlite3.connect('/data/backup.db'); src.backup(dst); dst.close(); src.close()"
docker compose cp sync:/data/backup.db ./lifedash-backup.db
```

Keep the copied backup somewhere separate from the running data volume.
The destination file is overwritten on the next backup, so rename or archive
it if you need multiple versions.

## Upgrading

```bash
git pull
docker compose up -d --build
```

The schema migrates on startup; the database file carries over. Backup
first, as with anything that holds your data.

## Troubleshooting

- **"Sign in failed: 401"** - the username or password did not match. Use Sign
  in for an existing account; Create account is a separate operation.
- **"username taken" (409)** - that username already exists. Sign in or use a
  different username if another account is intended.
- **"registration is closed" (403)** - expected once you closed it; set
  `SYNC_OPEN_REGISTRATION=1` temporarily to add another account.
- **Nothing syncs** - check `/api/health` from the device's network,
  then the browser console (auto-sync failures log there). The app
  needs to reach the server URL exactly as entered, including scheme.
- **Attachments missing on the second device** - attachment blobs stay
  local to each device in v1 (metadata syncs). Tasks, projects, habits
  habit logs, goals, notes and journal all sync. Focus-session history is local
  only and included in JSON backups, not server sync.
