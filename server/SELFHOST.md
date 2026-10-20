# Self-hosting the Lifedash sync server

The sync server is a single FastAPI process with one SQLite file. No
other services, no external database. Anything below works on a
Raspberry Pi, a $5 VPS, or a NAS.

## Pick a deployment

### Docker (recommended)

```bash
cd server
docker compose up -d --build
curl http://localhost:8787/api/health   # {"ok":true}
```

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
WorkingDirectory=/opt/lifedash/server
Environment=SYNC_DB=/var/lib/lifedash/lifedash.db
ExecStart=/opt/lifedash/server/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8787
Restart=always
User=lifedash

[Install]
WantedBy=multi-user.target
```

## Create your account, then close registration

Registration is open while `SYNC_OPEN_REGISTRATION=1`. Create your
account first, then set it to `"0"` (or remove it) and restart - after
that, nobody else can register. With Docker:

```bash
# 1. with SYNC_OPEN_REGISTRATION: "1" in docker-compose.yml
curl -X POST http://localhost:8787/api/register \
  -H 'Content-Type: application/json' \
  -d '{"username":"you","password":"a-long-password"}'
# 2. set SYNC_OPEN_REGISTRATION: "0", then
docker compose up -d
```

You can also skip this dance and create the account from the app:
Sync -> Create account, while registration is still open.

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

In Lifedash: sidebar -> **Sync** -> paste the server URL
(`https://sync.example.com`) -> sign in (or create the account here
while registration is open). Sync runs on focus, on reconnect, every
5 minutes, and a few seconds after any edit. Sync now forces a round.

Every device uses the same account; each keeps its own cursor.

## Backups

Everything is one SQLite file. Stop-free backup with the SQLite CLI:

```bash
sqlite3 /data/lifedash.db ".backup '/backups/lifedash-$(date +%F).db'"
```

With Docker: `docker compose exec sync sqlite3 /data/lifedash.db ".backup '/data/backup.db'"`
and copy `backup.db` out of the volume. Nightly cron is plenty - the
file is small.

## Upgrading

```bash
git pull
docker compose up -d --build
```

The schema migrates on startup; the database file carries over. Backup
first, as with anything that holds your data.

## Troubleshooting

- **"Sign in failed: 401"** - wrong password, or you are registering
  on a server that already has a user (use Sign in, not Create account).
- **"registration is closed" (403)** - expected once you closed it; set
  `SYNC_OPEN_REGISTRATION=1` temporarily to add another account.
- **Nothing syncs** - check `/api/health` from the device's network,
  then the browser console (auto-sync failures log there). The app
  needs to reach the server URL exactly as entered, including scheme.
- **Attachments missing on the second device** - attachment blobs stay
  local to each device in v1 (metadata syncs). Tasks, projects, habits
  and habit logs all sync.
