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

## First-run checklist

From the repository root, `make setup` guides a Compose installation. It checks
Docker, daemon access and Compose config before asking whether to build/start.
It does not collect credentials, change registration policy, or configure TLS.
Use `make setup-check` for a read-only preflight; neither check is proof that the
container images work. The actual build/start path still needs validation on a
Docker-capable host.


1. Keep the host private during setup. The Compose port mappings bind to host
   network interfaces, not only loopback.
2. From the repository root, run `docker compose config`, then
   `docker compose up -d --build` and `docker compose ps`.
3. Check `http://localhost:8787/api/health` on the server. Open the app at
   `http://localhost:8080`, then follow Settings -> Sync. The bundled
   `/selfhost.html` guide keeps these steps available alongside the app.
4. Create the first account before allowing anyone else access. There is no
   default password or email password-reset flow.
5. Configure HTTPS for both app and API before connecting another device.
   Sign into the same account there and verify a fictional task syncs both ways.
6. Take device JSON exports and a server backup before using important data.
   Restore a copy in isolation before trusting the backup.

The guide is a static checklist, not an automatic installer or server probe.

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

## Test a backup before recovery

A server backup contains account credentials/tokens and synced records. Treat it
as private. It does not include device-only attachment files or focus history.
Device JSON exports include focus history but only attachment metadata, not file
contents. Keep original attachment files separately as well as device exports. Never copy just the live SQLite file while writes
are active: use the online backup command above.

To check the copied snapshot without modifying it, run on a host with Python:

```bash
python3 -c "import sqlite3; c=sqlite3.connect('file:lifedash-backup.db?mode=ro', uri=True); print(c.execute('PRAGMA integrity_check').fetchone()[0]); c.close()"
```

Expect `ok`. Integrity is not proof of complete recovery. For a recovery drill,
copy the backup into a separate directory and start a separate sync process
using the bare-metal command with `SYNC_DB` pointing at that copy and a different
loopback port. Use a separate browser profile with fictional data to verify
login and expected records. Do not point a real client at a recovery test.

Replacing the live database is destructive. Stop all sync writers first, retain
an online backup of the current state and the current code version, and restore
into a fresh data location. Do not leave old WAL/SHM sidecars beside the restored
database. Check login and records before reconnecting clients. This guide does
not automatically perform recovery. `docker compose down` preserves data;
`docker compose down -v` deletes the volume and must not be used for upgrades.

For a synthetic, non-Docker drill after `make install`, run
`make test-selfhost` from the repo root on a POSIX host. It verifies a real
loopback uvicorn process, account/auth behavior, restart persistence, an online
SQLite backup and restored login/data, then deletes the temporary databases.
It does not establish Docker image, TLS or real-device readiness.

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
  local to each device in v1 (metadata syncs). JSON exports also contain only
  attachment metadata; keep original files separately. Tasks, projects, habits
  habit logs, goals, notes and journal all sync. Focus-session history is local
  only and included in JSON backups, not server sync.
