"""Lifedash sync server.

Protocol: docs/sync-protocol.md. Push applies changes whose base_rev
matches the server's current rev for that entity; anything else comes
back as a conflict carrying the server's version (server-wins MVP).
"""

import json
import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from .auth import current_user, hash_password, new_token, verify_password
from .db import get_conn, init_db
from .agent import init_agent_db, router as agent_router
from .gcal import router as gcal_router

COLLECTIONS = {"tasks", "projects", "tags", "habits", "habitLogs", "goals", "notes", "journal", "focusSessions"}


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    init_agent_db()
    yield


app = FastAPI(title="Lifedash Sync Server", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

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
        token = new_token()
        conn.execute("INSERT INTO tokens (token, user_id) VALUES (?, ?)", (token, user_id))
        conn.commit()
    except HTTPException:
        raise
    except Exception as exc:
        conn.rollback()
        raise HTTPException(status_code=409, detail="username taken") from exc
    return {"token": token, "user_id": user_id}


@app.post("/api/login")
def login(creds: Credentials):
    conn = get_conn()
    row = conn.execute(
        "SELECT id, password_hash FROM users WHERE username = ?", (creds.username,)
    ).fetchone()
    if row is None or not verify_password(creds.password, row["password_hash"]):
        raise HTTPException(status_code=401, detail="invalid credentials")
    token = new_token()
    conn.execute("INSERT INTO tokens (token, user_id) VALUES (?, ?)", (token, row["id"]))
    conn.commit()
    return {"token": token, "user_id": row["id"]}


@app.post("/api/logout", status_code=204)
def logout(authorization: str = Header(default="")):
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len(prefix):].strip()
    conn = get_conn()
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
                "data": json.loads(r["data"]),
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
                            "data": json.loads(row["data"]) if row else None,
                        },
                    }
                )
                continue
            conn.execute("UPDATE meta SET last_rev = last_rev + 1 WHERE user_id = ?", (user_id,))
            new_rev = conn.execute(
                "SELECT last_rev FROM meta WHERE user_id = ?", (user_id,)
            ).fetchone()["last_rev"]
            conn.execute(
                "INSERT INTO entities (user_id, collection, id, rev, deleted, data) "
                "VALUES (?, ?, ?, ?, ?, ?) "
                "ON CONFLICT (user_id, collection, id) DO UPDATE SET "
                "rev=excluded.rev, deleted=excluded.deleted, data=excluded.data, "
                "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
                (user_id, ch.collection, ch.id, new_rev, 1 if ch.deleted else 0, json.dumps(ch.data)),
            )
            results.append(
                {"collection": ch.collection, "id": ch.id, "status": "ok", "rev": new_rev}
            )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    return {"results": results}
