# Lifedash Sync Server

Self-hosted sync backend for the Lifedash PWA. FastAPI + SQLite, one
file database, no other services. Protocol: `docs/sync-protocol.md`.

See **SELFHOST.md** for the full deployment guide (TLS, accounts,
backups, upgrades, troubleshooting).

## Quick start (Docker)

```bash
docker compose up -d --build
# This sync-only Compose file sets SYNC_OPEN_REGISTRATION=1.
# Create your account(s), set that entry to "0", then recreate the service.
# Connect through HTTPS beyond localhost; see SELFHOST.md.
```

Put it behind a TLS reverse proxy (Caddy, Nginx Proxy Manager, Tailscale
Funnel) before exposing it beyond localhost - tokens are bearer tokens.

## Local development

```bash
pip install -r requirements-dev.txt
SYNC_DB=./dev.db SYNC_OPEN_REGISTRATION=1 uvicorn app.main:app --port 8787 --no-proxy-headers
pytest
```

## API

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| GET | /api/health | - | liveness |
| POST | /api/register | - | create account, returns token |
| POST | /api/login | - | returns token |
| GET | /api/changes?since=N | bearer | latest state of entities with rev > N, plus current rev |
| POST | /api/changes | bearer | apply a batch of changes (base_rev checked per entity) |

## Environment

- `SYNC_DB` - SQLite file path (default `/data/lifedash.db`)
- `SYNC_OPEN_REGISTRATION` - `1` allows new accounts after the first user

## Notes

- Entities are opaque JSON blobs; the server does not interpret task
  fields. Conflict handling is server-wins with the server's version
  returned to the client (see protocol doc).
- Attachment metadata and binary files are not synced in v1. Device portable backups include both.
- Secrets: bearer tokens and PBKDF2-hashed passwords, nothing else stored.
