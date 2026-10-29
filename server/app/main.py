"""Lifedash sync server.

Protocol: docs/sync-protocol.md. Push applies changes whose base_rev
matches the server's current rev for that entity; anything else comes
back as a conflict carrying the server's version (server-wins MVP).
"""

import json
import os
import time
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .auth import _is_digest, current_user, hash_password, hash_token, migrate_tokens, new_token, store_token, verify_password
from .db import get_conn, init_db
from .agent import _ATTACHMENT_ID_RE, _blob_path, init_agent_db, router as agent_router
from .gcal import router as gcal_router

COLLECTIONS = {"tasks", "projects", "tags", "habits", "habitLogs", "goals", "notes", "journal", "focusSessions", "attachments", "automationRules", "userRules"}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    init_agent_db()
    migrate_tokens()
    yield


app = FastAPI(title="Lifedash Sync Server", version="0.1.0", lifespan=lifespan)
# Browser clients call the API cross-origin with bearer tokens (no ambient
# cookies), so the default stays permissive for self-host compatibility;
# SYNC_CORS_ORIGINS="https://app.example,https://app2.example" restricts it.
_cors_env = os.environ.get("SYNC_CORS_ORIGINS", "").strip()
_cors_origins = [o.strip() for o in _cors_env.split(",") if o.strip()] or ["*"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _max_body_bytes() -> int:
    try:
        return int(os.environ.get("SYNC_MAX_BODY_MB", "10")) * 1024 * 1024
    except ValueError:
        return 10 * 1024 * 1024


async def _send_413(send) -> None:
    body = b'{"detail":"request body too large"}'
    await send({"type": "http.response.start", "status": 413,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]})
    await send({"type": "http.response.body", "body": body})


class BodyLimitMiddleware:
    """Pure-ASGI body cap. A declared Content-Length over the limit is
    rejected up front; a request without one (chunked, or none) is counted
    while it streams and rejected as soon as it crosses the limit. Blob
    uploads are exempt: they stream with their own per-file cap."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        if scope.get("method") == "POST" and scope.get("path", "") == "/api/attachments":
            return await self.app(scope, receive, send)
        limit = _max_body_bytes()
        raw = None
        for k, v in scope.get("headers") or []:
            if k == b"content-length":
                raw = v
                break
        if raw is not None:
            try:
                if int(raw) > limit:
                    return await _send_413(send)
            except ValueError:
                pass
            return await self.app(scope, receive, send)
        # No Content-Length: count while streaming, replay the buffered body.
        body = b""
        while True:
            message = await receive()
            if message["type"] != "http.request":
                return  # client disconnected before the body completed
            body += message.get("body", b"")
            if len(body) > limit:
                return await _send_413(send)
            if not message.get("more_body"):
                break
        sent = False

        async def replay():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.request", "body": b"", "more_body": False}

        return await self.app(scope, replay, send)


app.add_middleware(BodyLimitMiddleware)

app.include_router(gcal_router)
app.include_router(agent_router)


class Credentials(BaseModel):
    username: str = Field(min_length=1, max_length=128)
    password: str = Field(min_length=8, max_length=256)


class ChangeIn(BaseModel):
    collection: str = Field(min_length=1, max_length=64)
    id: str = Field(min_length=1, max_length=128)
    base_rev: int = Field(default=0, ge=0)
    deleted: bool = False
    data: dict = Field(default_factory=dict)


class PushBody(BaseModel):
    changes: list[ChangeIn] = Field(default_factory=list, max_length=1000)


@app.get("/api/health")
def health():
    return {"ok": True}


@app.post("/api/register")
def register(creds: Credentials):
    conn = get_conn()
    count = conn.execute("SELECT COUNT(*) AS n FROM users").fetchone()["n"]
    if count > 0 and os.environ.get("SYNC_OPEN_REGISTRATION", "0") != "1":
        raise HTTPException(status_code=403, detail="registration is closed")
    try:
        cur = conn.execute(
            "INSERT INTO users (username, password_hash) VALUES (?, ?)",
            (creds.username, hash_password(creds.password)),
        )
        user_id = cur.lastrowid
        conn.execute("INSERT INTO meta (user_id, last_rev) VALUES (?, 0)", (user_id,))
        token = store_token(user_id)
        conn.commit()
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=409, detail="username taken") from exc
    return {"token": token, "user_id": user_id}


# Login throttling that actually throttles: the check runs BEFORE the
# password verification, so rejected guesses cost no PBKDF2 work. Keys are
# (username, client IP): spraying a known username from one address never
# touches the same user signing in from another. X-Forwarded-For is trusted
# only when SYNC_TRUSTED_PROXY=1 (behind Caddy/nginx on the same host);
# otherwise the socket peer is used, which behind an unconfigured proxy
# collapses to one key per username - safe, just shared.
#
# Tradeoff, stated plainly: from a throttled (username, IP) pair, even the
# correct password waits out the backoff (429 + Retry-After, capped at 15
# minutes, doubling from 2s). A success clears the counter. Existing
# session tokens are never affected - login failures do not invalidate
# tokens, so already-connected devices keep working throughout.
THROTTLE_FREE_ATTEMPTS = 5
THROTTLE_MAX_DELAY_S = 900
THROTTLE_IDLE_S = 24 * 60 * 60
THROTTLE_MAX_ROWS = 10_000


def _throttle_key(request: Request, username: str) -> tuple[str, str]:
    ip = "unknown"
    if os.environ.get("SYNC_TRUSTED_PROXY", "0") == "1":
        xff = request.headers.get("x-forwarded-for")
        if xff:
            ip = xff.split(",")[0].strip()
    if ip == "unknown" and request.client:
        ip = request.client.host
    return username, ip


def _throttle_check(conn, username: str, ip: str) -> None:
    row = conn.execute(
        "SELECT next_allowed FROM login_throttle WHERE username = ? AND ip = ?", (username, ip)
    ).fetchone()
    if row is None:
        return
    wait = row["next_allowed"] - time.time()
    if wait > 0:
        raise HTTPException(
            status_code=429,
            detail=f"too many failed attempts; retry in {int(wait) + 1}s",
            headers={"Retry-After": str(int(wait) + 1)},
        )


def _throttle_failed(conn, username: str, ip: str) -> None:
    now = time.time()
    row = conn.execute(
        "SELECT fail_count, window_start FROM login_throttle WHERE username = ? AND ip = ?",
        (username, ip),
    ).fetchone()
    if row is None or now - row["window_start"] > THROTTLE_IDLE_S:
        if row is None:
            conn.execute("DELETE FROM login_throttle WHERE ? - window_start > ?", (now, THROTTLE_IDLE_S))
            n = conn.execute("SELECT COUNT(*) AS n FROM login_throttle").fetchone()["n"]
            if n >= THROTTLE_MAX_ROWS:
                conn.commit()
                return
        fails, window_start = 1, now
    else:
        fails, window_start = row["fail_count"] + 1, row["window_start"]
    delay = 0.0 if fails <= THROTTLE_FREE_ATTEMPTS else min(2.0 ** (fails - THROTTLE_FREE_ATTEMPTS), THROTTLE_MAX_DELAY_S)
    conn.execute(
        "INSERT OR REPLACE INTO login_throttle (username, ip, fail_count, window_start, next_allowed)"
        " VALUES (?, ?, ?, ?, ?)",
        (username, ip, fails, window_start, now + delay),
    )
    conn.commit()


@app.post("/api/login")
def login(creds: Credentials, request: Request):
    conn = get_conn()
    username, ip = _throttle_key(request, creds.username)
    _throttle_check(conn, username, ip)
    row = conn.execute(
        "SELECT id, password_hash FROM users WHERE username = ?", (creds.username,)
    ).fetchone()
    if row is None:
        # Equalize the timing of unknown vs known usernames.
        verify_password(creds.password, "00" * 16 + ":" + "00" * 32)
    if row is not None and verify_password(creds.password, row["password_hash"]):
        conn.execute("DELETE FROM login_throttle WHERE username = ? AND ip = ?", (username, ip))
        token = store_token(row["id"])
        conn.commit()
        return {"token": token, "user_id": row["id"]}
    _throttle_failed(conn, username, ip)
    raise HTTPException(status_code=401, detail="invalid credentials")


@app.post("/api/logout", status_code=204)
def logout(authorization: str = Header(default="")):
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len(prefix):].strip()
    conn = get_conn()
    cur = conn.execute("DELETE FROM tokens WHERE token = ?", (hash_token(token),))
    if cur.rowcount == 0 and not _is_digest(token):  # legacy plaintext row
        cur = conn.execute("DELETE FROM tokens WHERE token = ?", (token,))
    conn.commit()
    if cur.rowcount == 0:
        raise HTTPException(status_code=401, detail="invalid token")


@app.get("/api/changes")
def pull(since: int = 0, user_id: int = Depends(current_user)):
    conn = get_conn()
    rows = conn.execute(
        "SELECT collection, id, rev, deleted, data FROM entities "
        "WHERE user_id = ? AND rev > ? ORDER BY rev",
        (user_id, since),
    ).fetchall()
    meta = conn.execute("SELECT last_rev FROM meta WHERE user_id = ?", (user_id,)).fetchone()
    return {
        "rev": meta["last_rev"],
        "changes": [
            {
                "collection": r["collection"],
                "id": r["id"],
                "rev": r["rev"],
                "deleted": bool(r["deleted"]),
                # Tombstone payloads stay on the server (restore path is the
                # agent API); clients only need the deletion marker.
                "data": {} if r["deleted"] else json.loads(r["data"]),
            }
            for r in rows
        ],
    }


@app.post("/api/changes")
def push(body: PushBody, user_id: int = Depends(current_user)):
    conn = get_conn()
    results = []
    try:
        conn.execute("BEGIN IMMEDIATE")
        for ch in body.changes:
            if ch.collection not in COLLECTIONS:
                results.append(
                    {"collection": ch.collection, "id": ch.id, "status": "unknown_collection"}
                )
                continue
            if ch.collection == "attachments" and not _ATTACHMENT_ID_RE.match(ch.id):
                # Blob paths are built from attachment ids on the server.
                results.append(
                    {"collection": ch.collection, "id": ch.id, "status": "invalid_id"}
                )
                continue
            row = conn.execute(
                "SELECT rev, deleted, data FROM entities "
                "WHERE user_id = ? AND collection = ? AND id = ?",
                (user_id, ch.collection, ch.id),
            ).fetchone()
            current_rev = row["rev"] if row else 0
            if ch.base_rev != current_rev:
                results.append(
                    {
                        "collection": ch.collection,
                        "id": ch.id,
                        "status": "conflict",
                        "current": {
                            "rev": current_rev,
                            "deleted": bool(row["deleted"]) if row else False,
                            "data": ({} if row["deleted"] else json.loads(row["data"])) if row else None,
                        },
                    }
                )
                continue
            conn.execute("UPDATE meta SET last_rev = last_rev + 1 WHERE user_id = ?", (user_id,))
            new_rev = conn.execute(
                "SELECT last_rev FROM meta WHERE user_id = ?", (user_id,)
            ).fetchone()["last_rev"]
            # Tombstones keep the last known payload server-side (recoverable
            # soft delete); clients send data: {} because they drop their copy.
            data_json = row["data"] if (ch.deleted and row) else json.dumps(ch.data)
            if ch.collection == "attachments" and not ch.deleted:
                # The server alone grounds blob presence; a client claim in
                # pushed metadata is only a cache hint and can lie.
                data = dict(ch.data) if isinstance(ch.data, dict) else {}
                data["blobOnServer"] = os.path.exists(_blob_path(user_id, ch.id))
                data_json = json.dumps(data)
            conn.execute(
                "INSERT INTO entities (user_id, collection, id, rev, deleted, data) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (user_id, collection, id) DO UPDATE SET "
                "rev=excluded.rev, deleted=excluded.deleted, data=excluded.data, "
                "deleted_with=CASE WHEN excluded.deleted = 0 THEN NULL ELSE entities.deleted_with END, "
                "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                (user_id, ch.collection, ch.id, new_rev, 1 if ch.deleted else 0, data_json),
            )
            results.append(
                {"collection": ch.collection, "id": ch.id, "status": "ok", "rev": new_rev}
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"results": results}
