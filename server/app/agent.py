"""Agent API: named, scoped, revocable tokens plus validated write operations.

Read endpoints mirror the current (non-deleted) state of every synced
collection. Write endpoints apply the SAME invariants the app enforces
client-side (recurrence spawning on completion, one habit log per day,
one journal entry per date, referential integrity, cycle rejection) so
an agent can never put the data into a state the app would not itself
create. Deletes are tombstones only - soft delete, never permanent.

Tokens are random 256-bit strings shown once at creation; only the
SHA-256 hash is stored. Management (create/list/revoke) uses the normal
session token; agent calls authenticate with the agent token itself.
"""

import hashlib
import json
import re
import secrets
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from dateutil import rrule
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from .auth import current_user
from .db import get_conn

router = APIRouter(prefix="/api")

SCOPES = ("read", "read-write")
MAX_TOKENS = 25  # bound on stored keys per user, not a request-rate limit

SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read','read-write')),
  token_hash TEXT UNIQUE NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_used_at TEXT,
  revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS agent_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_id TEXT NOT NULL,
  ts TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  action TEXT NOT NULL,
  collection TEXT,
  entity_id TEXT,
  detail TEXT
);
"""

AGENT_COLLECTIONS = {"tasks", "projects", "habits", "habitLogs", "goals", "notes", "journal"}


def init_agent_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _now_ms() -> int:
    return int(time.time() * 1000)


def _new_id() -> str:
    return str(uuid.uuid4())


# ---------- auth ----------

class AgentCtx(BaseModel):
    token_id: str
    user_id: int
    name: str
    scope: str


def agent_auth(authorization: str = Header(default="")) -> AgentCtx:
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len(prefix):].strip()
    conn = get_conn()
    row = conn.execute(
        "SELECT id, user_id, name, scope, revoked_at FROM agent_tokens WHERE token_hash = ?",
        (_hash(token),),
    ).fetchone()
    if row is None or row["revoked_at"] is not None:
        raise HTTPException(status_code=401, detail="invalid or revoked agent token")
    conn.execute(
        "UPDATE agent_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
        (row["id"],),
    )
    conn.commit()
    return AgentCtx(token_id=row["id"], user_id=row["user_id"], name=row["name"], scope=row["scope"])


def require_write(ctx: AgentCtx) -> None:
    if ctx.scope != "read-write":
        raise HTTPException(status_code=403, detail="this key is read-only")


# ---------- storage helpers ----------

def _apply(conn, user_id: int, collection: str, entity_id: str, deleted: bool, data: dict) -> int:
    """One entity change with a fresh rev, identical to the sync push path."""
    conn.execute("UPDATE meta SET last_rev = last_rev + 1 WHERE user_id = ?", (user_id,))
    rev = conn.execute("SELECT last_rev FROM meta WHERE user_id = ?", (user_id,)).fetchone()["last_rev"]
    conn.execute(
        "INSERT INTO entities (user_id, collection, id, rev, deleted, data) "
        "VALUES (?, ?, ?, ?, ?, ?) "
        "ON CONFLICT (user_id, collection, id) DO UPDATE SET "
        "rev=excluded.rev, deleted=excluded.deleted, data=excluded.data, "
        "updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        (user_id, collection, entity_id, rev, 1 if deleted else 0, json.dumps(data)),
    )
    return rev


def _get(conn, user_id: int, collection: str, entity_id: str, include_deleted: bool = False):
    row = conn.execute(
        "SELECT deleted, data FROM entities WHERE user_id = ? AND collection = ? AND id = ?",
        (user_id, collection, entity_id),
    ).fetchone()
    if row is None:
        return None
    if row["deleted"] and not include_deleted:
        return None
    return {"id": entity_id, "deleted": bool(row["deleted"]), "data": json.loads(row["data"])}


def _all(conn, user_id: int, collection: str) -> list[dict]:
    rows = conn.execute(
        "SELECT id, data FROM entities WHERE user_id = ? AND collection = ? AND deleted = 0",
        (user_id, collection),
    ).fetchall()
    return [json.loads(r["data"]) | {"id": r["id"]} for r in rows]


def _audit(conn, ctx: AgentCtx, action: str, collection=None, entity_id=None, detail=None) -> None:
    conn.execute(
        "INSERT INTO agent_audit (token_id, action, collection, entity_id, detail) VALUES (?, ?, ?, ?, ?)",
        (ctx.token_id, action, collection, entity_id, (detail or "")[:500]),
    )


def _write(ctx: AgentCtx, fn):
    """Run fn(conn) for a write op: scope check, one transaction, audit by fn."""
    require_write(ctx)
    conn = get_conn()
    try:
        conn.execute("BEGIN IMMEDIATE")
        result = fn(conn)
        conn.commit()
        return result
    except HTTPException:
        conn.rollback()
        raise
    except Exception:
        conn.rollback()
        raise


# ---------- validation helpers (ports of the client rules) ----------

_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")


def _valid_date(s: str) -> bool:
    if not _DATE_RE.match(s):
        return False
    try:
        date.fromisoformat(s)
        return True
    except ValueError:
        return False


def _opt_date(v, field):
    if v is None:
        return None
    if not _valid_date(v):
        raise HTTPException(status_code=422, detail=f"{field} must be a real YYYY-MM-DD date")
    return v


def _opt_time(v, field):
    if v is None:
        return None
    if not _TIME_RE.match(v):
        raise HTTPException(status_code=422, detail=f"{field} must be HH:MM (24h)")
    return v


def _norm_tag(raw: str) -> str:
    return re.sub(r"\s+", "-", raw.strip().lstrip("#").lower())


def _norm_tags(tags: list[str]) -> list[str]:
    out = []
    for t in tags:
        n = _norm_tag(t)
        if n and n not in out:
            out.append(n)
    return out


def _parse_rule(rule: str):
    """dateutil rruleset for an RRULE string with DTSTART; None when malformed."""
    try:
        return rrule.rrulestr(rule, forceset=False)
    except (ValueError, TypeError):
        return None


def _next_monthly_clamped(day: int, base: str) -> str:
    year, month = int(base[:4]), int(base[5:7])
    for _ in range(2400):
        if month == 12:
            dim = 31
        else:
            dim = (date(year, month + 1, 1) - timedelta(days=1)).day
        cand = f"{year:04d}-{month:02d}-{min(day, dim):02d}"
        if cand > base:
            return cand
        month += 1
        if month == 13:
            month, year = 1, year + 1
    return base


def next_occurrence_date(rule: str, due_date: str, today: str) -> str | None:
    """Port of the client's nextOccurrenceDate: next local date strictly after
    max(dueDate, today); malformed rules yield None so completion is never blocked."""
    rr = _parse_rule(rule)
    if rr is None:
        return None
    base = max(due_date, today)
    mdays = rr._bymonthday if isinstance(rr._bymonthday, (list, tuple)) else ([rr._bymonthday] if rr._bymonthday else [])
    if (
        rr._freq == rrule.MONTHLY
        and (rr._interval or 1) == 1
        and len(mdays) == 1
        and not rr._byweekday
        and not rr._bysetpos
    ):
        return _next_monthly_clamped(int(mdays[0]), base)
    y, m, d = int(base[:4]), int(base[5:7]), int(base[8:10])
    anchor = datetime(y, m, d, 12, 0, tzinfo=timezone.utc)
    nxt = rr.after(anchor, inc=False)
    if nxt is None:
        return None
    return nxt.date().isoformat()


def _would_create_cycle(tasks: list[dict], task_id: str, blocker_id: str) -> bool:
    """Port of the client's wouldCreateCycle over the blockedBy graph."""
    if task_id == blocker_id:
        return True
    by_id = {t["id"]: t for t in tasks}
    seen, queue = set(), [blocker_id]
    while queue:
        cur = queue.pop()
        if cur == task_id:
            return True
        if cur in seen:
            continue
        seen.add(cur)
        t = by_id.get(cur)
        for nxt in (t or {}).get("blockedBy") or []:
            queue.append(nxt)
    return False


def _project_would_cycle(projects: list[dict], pid: str, new_parent) -> bool:
    """Port of the client's projects.wouldCycle (dangling parent = refuse)."""
    if new_parent is None:
        return False
    if new_parent == pid:
        return True
    by_id = {p["id"]: p for p in projects}
    cur, seen = new_parent, {pid}
    while cur is not None:
        if cur in seen:
            return True
        seen.add(cur)
        parent = by_id.get(cur)
        if not parent:
            return True
        cur = parent.get("parentId") or None
    return False


# ---------- token management (session auth) ----------

class TokenCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    scope: str = Field(default="read-write")


@router.post("/agent-tokens", status_code=201)
def create_token(body: TokenCreate, user_id: int = Depends(current_user)):
    if body.scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope must be 'read' or 'read-write'")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    conn = get_conn()
    active = conn.execute(
        "SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL", (user_id,)
    ).fetchone()["n"]
    if active >= MAX_TOKENS:
        raise HTTPException(status_code=409, detail=f"at most {MAX_TOKENS} active keys; revoke one first")
    token = "ldk_" + secrets.token_urlsafe(32)
    tid = _new_id()
    conn.execute(
        "INSERT INTO agent_tokens (id, user_id, name, scope, token_hash) VALUES (?, ?, ?, ?, ?)",
        (tid, user_id, name, body.scope, _hash(token)),
    )
    conn.commit()
    row = conn.execute("SELECT created_at FROM agent_tokens WHERE id = ?", (tid,)).fetchone()
    return {"id": tid, "name": name, "scope": body.scope, "token": token, "created_at": row["created_at"]}


@router.get("/agent-tokens")
def list_tokens(user_id: int = Depends(current_user)):
    rows = get_conn().execute(
        "SELECT id, name, scope, created_at, last_used_at, revoked_at FROM agent_tokens "
        "WHERE user_id = ? ORDER BY created_at",
        (user_id,),
    ).fetchall()
    return {
        "tokens": [
            {k: r[k] for k in ("id", "name", "scope", "created_at", "last_used_at", "revoked_at")}
            for r in rows
        ]
    }


@router.post("/agent-tokens/{token_id}/revoke", status_code=204)
def revoke_token(token_id: str, user_id: int = Depends(current_user)):
    conn = get_conn()
    row = conn.execute(
        "SELECT id, revoked_at FROM agent_tokens WHERE id = ? AND user_id = ?", (token_id, user_id)
    ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="unknown key")
    if row["revoked_at"] is None:
        conn.execute(
            "UPDATE agent_tokens SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
            (token_id,),
        )
        conn.commit()


# ---------- read endpoints (agent auth, any scope) ----------

@router.get("/agent/collections")
def agent_collections(ctx: AgentCtx = Depends(agent_auth)):
    conn = get_conn()
    out = {}
    for col in sorted(AGENT_COLLECTIONS):
        out[col] = conn.execute(
            "SELECT COUNT(*) AS n FROM entities WHERE user_id = ? AND collection = ? AND deleted = 0",
            (ctx.user_id, col),
        ).fetchone()["n"]
    return {"collections": out}


@router.get("/agent/entities/{collection}")
def agent_list(collection: str, limit: int = 1000, offset: int = 0, include_deleted: bool = False,
               ctx: AgentCtx = Depends(agent_auth)):
    if collection not in AGENT_COLLECTIONS:
        raise HTTPException(status_code=404, detail="unknown collection")
    limit = max(1, min(limit, 5000))
    offset = max(0, offset)
    where = "" if include_deleted else "AND deleted = 0"
    rows = get_conn().execute(
        f"SELECT id, deleted, data FROM entities WHERE user_id = ? AND collection = ? {where} "
        "ORDER BY id LIMIT ? OFFSET ?",
        (ctx.user_id, collection, limit, offset),
    ).fetchall()
    return {
        "entities": [
            {"id": r["id"], "deleted": bool(r["deleted"]), "data": json.loads(r["data"])}
            for r in rows
        ]
    }


@router.get("/agent/entities/{collection}/{entity_id}")
def agent_get(collection: str, entity_id: str, ctx: AgentCtx = Depends(agent_auth)):
    if collection not in AGENT_COLLECTIONS:
        raise HTTPException(status_code=404, detail="unknown collection")
    ent = _get(get_conn(), ctx.user_id, collection, entity_id, include_deleted=True)
    if ent is None:
        raise HTTPException(status_code=404, detail="not found")
    return ent


# ---------- task operations ----------

class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    projectId: str | None = None
    parentId: str | None = None
    goalId: str | None = None
    noteId: str | None = None
    dueDate: str | None = None
    dueTime: str | None = None
    priority: int = Field(default=0, ge=0, le=3)
    recurrence: str | None = Field(default=None, max_length=200)
    tags: list[str] = Field(default_factory=list, max_length=20)


def _require_entity(conn, user_id: int, collection: str, entity_id: str | None, field: str):
    if entity_id is None:
        return None
    ent = _get(conn, user_id, collection, entity_id)
    if ent is None:
        raise HTTPException(status_code=422, detail=f"{field}: no such {collection} entity")
    return ent


@router.post("/agent/tasks", status_code=201)
def agent_create_task(body: TaskCreate, ctx: AgentCtx = Depends(agent_auth)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="title must not be blank")
    due_date = _opt_date(body.dueDate, "dueDate")
    due_time = _opt_time(body.dueTime, "dueTime")
    if body.recurrence is not None and _parse_rule(body.recurrence) is None:
        raise HTTPException(status_code=422, detail="recurrence is not a valid RRULE string")

    def fn(conn):
        project_id = body.projectId or "inbox"
        if project_id == "inbox" and _get(conn, ctx.user_id, "projects", "inbox") is None:
            # The app seeds the Inbox locally on first run, but a fresh account
            # may not have pushed it yet. Seed the identical entity server-side
            # (same id and shape as the client's seed in db.ts); when the app's
            # own seed later pushes with base_rev 0 it conflicts and server-wins
            # replaces it with these same values.
            inbox = {"id": "inbox", "name": "Inbox", "color": "#0f766e", "order": 0, "archived": False}
            _apply(conn, ctx.user_id, "projects", "inbox", False, inbox)
            _audit(conn, ctx, "project.seed_inbox", "projects", "inbox")
        _require_entity(conn, ctx.user_id, "projects", project_id, "projectId")
        _require_entity(conn, ctx.user_id, "tasks", body.parentId, "parentId")
        _require_entity(conn, ctx.user_id, "goals", body.goalId, "goalId")
        _require_entity(conn, ctx.user_id, "notes", body.noteId, "noteId")
        siblings = [t for t in _all(conn, ctx.user_id, "tasks") if t.get("projectId") == project_id]
        order = max([t.get("order", 0) for t in siblings], default=0) + 1
        now = _now_ms()
        task = {
            "id": _new_id(),
            "title": title,
            "note": "",
            "noteDoc": None,
            "projectId": project_id,
            "parentId": body.parentId,
            "goalId": body.goalId,
            "noteId": body.noteId,
            "status": "active",
            "pinned": False,
            "priority": body.priority,
            "dueDate": due_date,
            "dueTime": due_time,
            "plannedDate": None,
            "plannedTime": None,
            "durationMinutes": None,
            "recurrence": body.recurrence,
            "skippedDates": [],
            "blockedBy": [],
            "tags": _norm_tags(body.tags),
            "order": order,
            "seriesId": None,
            "createdAt": now,
            "updatedAt": now,
            "completedAt": None,
        }
        _apply(conn, ctx.user_id, "tasks", task["id"], False, task)
        _audit(conn, ctx, "task.create", "tasks", task["id"], title[:80])
        return task

    return _write(ctx, fn)


class CompleteBody(BaseModel):
    today: str | None = None  # user's local YYYY-MM-DD; defaults to the server's local date


def _today_or(value: str | None) -> str:
    if value is None:
        return date.today().isoformat()
    return _opt_date(value, "today")


def _complete_task_data(task: dict, today: str, now: int) -> tuple[dict, dict | None]:
    """Port of the client's completeTask: updates plus the spawned next occurrence."""
    updates = {**task, "status": "done", "completedAt": now, "updatedAt": now}
    if not task.get("recurrence") or not task.get("dueDate"):
        return updates, None
    next_date = next_occurrence_date(task["recurrence"], task["dueDate"], today)
    if not next_date:
        return updates, None
    spawned = {
        "id": _new_id(),
        "title": task["title"],
        "note": task.get("note", ""),
        "noteDoc": task.get("noteDoc"),
        "projectId": task["projectId"],
        "parentId": task.get("parentId"),
        "goalId": task.get("goalId"),
        "noteId": task.get("noteId"),
        "status": "active",
        "pinned": task.get("pinned", False),
        "priority": task.get("priority", 0),
        "dueDate": next_date,
        "dueTime": task.get("dueTime"),
        "plannedDate": None,
        "plannedTime": None,
        "durationMinutes": task.get("durationMinutes"),
        "recurrence": task["recurrence"],
        "skippedDates": list(task.get("skippedDates") or []),
        "blockedBy": list(task.get("blockedBy") or []),
        "tags": list(task.get("tags") or []),
        "order": task.get("order", 0),
        "seriesId": task.get("seriesId") or task["id"],
        "createdAt": now,
        "updatedAt": now,
        "completedAt": None,
    }
    return updates, spawned


@router.post("/agent/tasks/{task_id}/complete")
def agent_complete_task(task_id: str, body: CompleteBody | None = None, ctx: AgentCtx = Depends(agent_auth)):
    today = _today_or(body.today if body else None)

    def fn(conn):
        ent = _get(conn, ctx.user_id, "tasks", task_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="task not found")
        task = ent["data"] | {"id": task_id}
        if task.get("status") != "active":
            _audit(conn, ctx, "task.complete.noop", "tasks", task_id, f"status={task.get('status')}")
            return {"changed": False, "task": task, "spawned": None}
        now = _now_ms()
        updated, spawned = _complete_task_data(task, today, now)
        _apply(conn, ctx.user_id, "tasks", task_id, False, updated)
        if spawned:
            _apply(conn, ctx.user_id, "tasks", spawned["id"], False, spawned)
        _audit(conn, ctx, "task.complete", "tasks", task_id,
               f"spawned={spawned['id']}" if spawned else "")
        return {"changed": True, "task": updated, "spawned": spawned}

    return _write(ctx, fn)


@router.post("/agent/tasks/{task_id}/uncomplete")
def agent_uncomplete_task(task_id: str, ctx: AgentCtx = Depends(agent_auth)):
    def fn(conn):
        ent = _get(conn, ctx.user_id, "tasks", task_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="task not found")
        task = ent["data"] | {"id": task_id}
        if task.get("status") != "done":
            _audit(conn, ctx, "task.uncomplete.noop", "tasks", task_id, f"status={task.get('status')}")
            return {"changed": False, "task": task}
        # Mirrors the client: the already-spawned next occurrence stays.
        updated = {**task, "status": "active", "completedAt": None, "updatedAt": _now_ms()}
        _apply(conn, ctx.user_id, "tasks", task_id, False, updated)
        _audit(conn, ctx, "task.uncomplete", "tasks", task_id)
        return {"changed": True, "task": updated}

    return _write(ctx, fn)


@router.post("/agent/tasks/{task_id}/skip")
def agent_skip_task(task_id: str, body: CompleteBody | None = None, ctx: AgentCtx = Depends(agent_auth)):
    today = _today_or(body.today if body else None)

    def fn(conn):
        ent = _get(conn, ctx.user_id, "tasks", task_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="task not found")
        task = ent["data"] | {"id": task_id}
        if not task.get("recurrence") or not task.get("dueDate"):
            raise HTTPException(status_code=409, detail="only a recurring task with a due date can be skipped")
        next_date = next_occurrence_date(task["recurrence"], task["dueDate"], today)
        if not next_date:
            raise HTTPException(status_code=409, detail="the repeat rule yields no next occurrence")
        updated = {
            **task,
            "dueDate": next_date,
            "plannedDate": None,
            "plannedTime": None,
            "skippedDates": [*(task.get("skippedDates") or []), task["dueDate"]],
            "updatedAt": _now_ms(),
        }
        _apply(conn, ctx.user_id, "tasks", task_id, False, updated)
        _audit(conn, ctx, "task.skip", "tasks", task_id, f"next={next_date}")
        return {"changed": True, "task": updated}

    return _write(ctx, fn)


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, max_length=500)
    note: str | None = Field(default=None, max_length=20000)
    projectId: str | None = None
    parentId: str | None = None
    goalId: str | None = None
    priority: int | None = Field(default=None, ge=0, le=3)
    dueDate: str | None = None
    dueTime: str | None = None
    plannedDate: str | None = None
    plannedTime: str | None = None
    durationMinutes: int | None = Field(default=None, ge=1, le=1440)
    pinned: bool | None = None
    recurrence: str | None = None
    tags: list[str] | None = None
    blockedBy: list[str] | None = None
    status: str | None = None  # only 'archived' is accepted here; use complete/uncomplete otherwise


_PATCHABLE = ("title", "note", "projectId", "parentId", "goalId", "priority", "dueDate",
              "dueTime", "plannedDate", "plannedTime", "durationMinutes", "pinned",
              "recurrence", "status")


@router.patch("/agent/tasks/{task_id}")
def agent_patch_task(task_id: str, body: TaskPatch, ctx: AgentCtx = Depends(agent_auth)):
    # model_fields_set distinguishes "field absent" from "explicitly null",
    # so agents can clear a due date or un-parent a task.
    given = body.model_fields_set
    if body.status is not None and body.status != "archived":
        raise HTTPException(status_code=422, detail="status changes use /complete or /uncomplete; only 'archived' may be patched")
    for f in ("dueDate", "plannedDate"):
        if f in given:
            _opt_date(getattr(body, f), f)
    for f in ("dueTime", "plannedTime"):
        if f in given:
            _opt_time(getattr(body, f), f)
    if "recurrence" in given and body.recurrence is not None and _parse_rule(body.recurrence) is None:
        raise HTTPException(status_code=422, detail="recurrence is not a valid RRULE string")
    if "title" in given and (body.title is None or not body.title.strip()):
        raise HTTPException(status_code=422, detail="title must not be blank")

    def fn(conn):
        ent = _get(conn, ctx.user_id, "tasks", task_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="task not found")
        task = ent["data"] | {"id": task_id}
        if "projectId" in given:
            _require_entity(conn, ctx.user_id, "projects", body.projectId, "projectId")
        if "goalId" in given:
            _require_entity(conn, ctx.user_id, "goals", body.goalId, "goalId")
        if "parentId" in given and body.parentId is not None:
            _require_entity(conn, ctx.user_id, "tasks", body.parentId, "parentId")
            if body.parentId == task_id:
                raise HTTPException(status_code=422, detail="a task cannot be its own parent")
            descendants = {task_id}
            frontier = [task_id]
            all_tasks = _all(conn, ctx.user_id, "tasks")
            while frontier:
                cur = frontier.pop()
                kids = [t["id"] for t in all_tasks if t.get("parentId") == cur]
                descendants.update(kids)
                frontier.extend(kids)
            if body.parentId in descendants:
                raise HTTPException(status_code=422, detail="a task cannot be moved under its own subtask")
        patch = {}
        for f in _PATCHABLE:
            if f in given:
                v = getattr(body, f)
                patch[f] = v.strip() if f == "title" and v else v
        if "tags" in given:
            patch["tags"] = _norm_tags(body.tags or [])
        if "blockedBy" in given:
            wanted = list(dict.fromkeys(body.blockedBy or []))
            tasks = _all(conn, ctx.user_id, "tasks")
            for b in wanted:
                _require_entity(conn, ctx.user_id, "tasks", b, "blockedBy")
                if _would_create_cycle(tasks, task_id, b):
                    raise HTTPException(status_code=422, detail=f"blocker {b} would create a dependency cycle")
            patch["blockedBy"] = wanted
        if "note" in given and patch.get("note") and task.get("noteDoc"):
            raise HTTPException(
                status_code=409,
                detail="this task has a rich-text note; patching 'note' would desync it. Edit the note in the app.",
            )
        if not patch:
            return {"changed": False, "task": task}
        updated = {**task, **patch, "updatedAt": _now_ms()}
        _apply(conn, ctx.user_id, "tasks", task_id, False, updated)
        _audit(conn, ctx, "task.patch", "tasks", task_id, ",".join(sorted(patch)))
        return {"changed": True, "task": updated}

    return _write(ctx, fn)


# ---------- habits ----------

class HabitCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    color: str = Field(default="#0f766e", max_length=32)
    weekdays: list[int] | None = None  # null = every day; else weekday numbers (0=Sun)


def _valid_weekdays(w):
    if w is None:
        return None
    if not all(isinstance(d, int) and 0 <= d <= 6 for d in w) or len(set(w)) != len(w) or not w:
        raise HTTPException(status_code=422, detail="weekdays must be distinct numbers 0-6 (0=Sun), or null for every day")
    return w


@router.post("/agent/habits", status_code=201)
def agent_create_habit(body: HabitCreate, ctx: AgentCtx = Depends(agent_auth)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    weekdays = _valid_weekdays(body.weekdays)

    def fn(conn):
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM entities WHERE user_id = ? AND collection = 'habits' AND deleted = 0",
            (ctx.user_id,),
        ).fetchone()["n"]
        habit = {"id": _new_id(), "name": name, "color": body.color, "weekdays": weekdays,
                 "order": count, "archived": False, "createdAt": _now_ms()}
        _apply(conn, ctx.user_id, "habits", habit["id"], False, habit)
        _audit(conn, ctx, "habit.create", "habits", habit["id"], name[:80])
        return habit

    return _write(ctx, fn)


class HabitPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    color: str | None = Field(default=None, max_length=32)
    weekdays: list[int] | None = None
    archived: bool | None = None


@router.patch("/agent/habits/{habit_id}")
def agent_patch_habit(habit_id: str, body: HabitPatch, ctx: AgentCtx = Depends(agent_auth)):
    given = body.model_fields_set
    if "weekdays" in given:
        _valid_weekdays(body.weekdays)
    if "name" in given and (body.name is None or not body.name.strip()):
        raise HTTPException(status_code=422, detail="name must not be blank")

    def fn(conn):
        ent = _get(conn, ctx.user_id, "habits", habit_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="habit not found")
        habit = ent["data"] | {"id": habit_id}
        patch = {}
        for f in ("name", "color", "archived"):
            if f in given:
                v = getattr(body, f)
                patch[f] = v.strip() if f == "name" and v else v
        if "weekdays" in given:
            patch["weekdays"] = body.weekdays
        if not patch:
            return {"changed": False, "habit": habit}
        updated = {**habit, **patch}
        _apply(conn, ctx.user_id, "habits", habit_id, False, updated)
        _audit(conn, ctx, "habit.patch", "habits", habit_id, ",".join(sorted(patch)))
        return {"changed": True, "habit": updated}

    return _write(ctx, fn)


class CheckBody(BaseModel):
    date: str  # local YYYY-MM-DD the check-in applies to


def _set_habit_log(ctx: AgentCtx, habit_id: str, body: CheckBody, done: bool):
    day = _opt_date(body.date, "date")

    def fn(conn):
        _require_entity(conn, ctx.user_id, "habits", habit_id, "habit")
        log_id = f"{habit_id}:{day}"
        existing = _get(conn, ctx.user_id, "habitLogs", log_id, include_deleted=True)
        if done:
            if existing and not existing["deleted"]:
                return {"changed": False, "log": existing["data"] | {"id": log_id}}
            log = {"id": log_id, "habitId": habit_id, "date": day, "doneAt": _now_ms()}
            _apply(conn, ctx.user_id, "habitLogs", log_id, False, log)
            _audit(conn, ctx, "habit.check", "habitLogs", log_id)
            return {"changed": True, "log": log}
        if not existing or existing["deleted"]:
            return {"changed": False, "log": None}
        _apply(conn, ctx.user_id, "habitLogs", log_id, True, {})
        _audit(conn, ctx, "habit.uncheck", "habitLogs", log_id)
        return {"changed": True, "log": None}

    return _write(ctx, fn)


@router.post("/agent/habits/{habit_id}/check")
def agent_check_habit(habit_id: str, body: CheckBody, ctx: AgentCtx = Depends(agent_auth)):
    return _set_habit_log(ctx, habit_id, body, True)


@router.post("/agent/habits/{habit_id}/uncheck")
def agent_uncheck_habit(habit_id: str, body: CheckBody, ctx: AgentCtx = Depends(agent_auth)):
    return _set_habit_log(ctx, habit_id, body, False)


# ---------- projects ----------

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    color: str = Field(default="#0f766e", max_length=32)
    parentId: str | None = None


@router.post("/agent/projects", status_code=201)
def agent_create_project(body: ProjectCreate, ctx: AgentCtx = Depends(agent_auth)):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")

    def fn(conn):
        projects = _all(conn, ctx.user_id, "projects")
        if body.parentId is not None and not any(p["id"] == body.parentId for p in projects):
            raise HTTPException(status_code=422, detail="parentId: no such project")
        project = {"id": _new_id(), "name": name, "color": body.color,
                   "order": len(projects), "archived": False, "parentId": body.parentId}
        _apply(conn, ctx.user_id, "projects", project["id"], False, project)
        _audit(conn, ctx, "project.create", "projects", project["id"], name[:80])
        return project

    return _write(ctx, fn)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, max_length=200)
    color: str | None = Field(default=None, max_length=32)
    parentId: str | None = None
    archived: bool | None = None


@router.patch("/agent/projects/{project_id}")
def agent_patch_project(project_id: str, body: ProjectPatch, ctx: AgentCtx = Depends(agent_auth)):
    given = body.model_fields_set
    if "name" in given and (body.name is None or not body.name.strip()):
        raise HTTPException(status_code=422, detail="name must not be blank")

    def fn(conn):
        ent = _get(conn, ctx.user_id, "projects", project_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="project not found")
        project = ent["data"] | {"id": project_id}
        patch = {}
        for f in ("name", "color", "archived"):
            if f in given:
                v = getattr(body, f)
                patch[f] = v.strip() if f == "name" and v else v
        if "parentId" in given:
            projects = _all(conn, ctx.user_id, "projects")
            if _project_would_cycle(projects, project_id, body.parentId):
                raise HTTPException(status_code=422, detail="that parent would create a project cycle")
            patch["parentId"] = body.parentId
        if not patch:
            return {"changed": False, "project": project}
        updated = {**project, **patch}
        _apply(conn, ctx.user_id, "projects", project_id, False, updated)
        _audit(conn, ctx, "project.patch", "projects", project_id, ",".join(sorted(patch)))
        return {"changed": True, "project": updated}

    return _write(ctx, fn)


# ---------- goals ----------

class GoalCreate(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    targetDate: str | None = None


@router.post("/agent/goals", status_code=201)
def agent_create_goal(body: GoalCreate, ctx: AgentCtx = Depends(agent_auth)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="title must not be blank")
    target = _opt_date(body.targetDate, "targetDate")

    def fn(conn):
        count = conn.execute(
            "SELECT COUNT(*) AS n FROM entities WHERE user_id = ? AND collection = 'goals' AND deleted = 0",
            (ctx.user_id,),
        ).fetchone()["n"]
        now = _now_ms()
        goal = {"id": _new_id(), "title": title, "note": "", "targetDate": target,
                "status": "active", "order": count, "createdAt": now, "updatedAt": now}
        _apply(conn, ctx.user_id, "goals", goal["id"], False, goal)
        _audit(conn, ctx, "goal.create", "goals", goal["id"], title[:80])
        return goal

    return _write(ctx, fn)


class GoalPatch(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    note: str | None = Field(default=None, max_length=20000)
    targetDate: str | None = None
    status: str | None = None
    habitIds: list[str] | None = None
    projectIds: list[str] | None = None


@router.patch("/agent/goals/{goal_id}")
def agent_patch_goal(goal_id: str, body: GoalPatch, ctx: AgentCtx = Depends(agent_auth)):
    given = body.model_fields_set
    if "title" in given and (body.title is None or not body.title.strip()):
        raise HTTPException(status_code=422, detail="title must not be blank")
    if "targetDate" in given:
        _opt_date(body.targetDate, "targetDate")
    if "status" in given and body.status not in ("active", "done", "archived"):
        raise HTTPException(status_code=422, detail="status must be active, done or archived")

    def fn(conn):
        ent = _get(conn, ctx.user_id, "goals", goal_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="goal not found")
        goal = ent["data"] | {"id": goal_id}
        patch = {}
        for f in ("title", "note", "targetDate", "status"):
            if f in given:
                v = getattr(body, f)
                patch[f] = v.strip() if f == "title" and v else v
        for f, col in (("habitIds", "habits"), ("projectIds", "projects")):
            if f in given:
                ids = list(dict.fromkeys(getattr(body, f) or []))
                for i in ids:
                    _require_entity(conn, ctx.user_id, col, i, f)
                patch[f] = ids
        if not patch:
            return {"changed": False, "goal": goal}
        updated = {**goal, **patch, "updatedAt": _now_ms()}
        _apply(conn, ctx.user_id, "goals", goal_id, False, updated)
        _audit(conn, ctx, "goal.patch", "goals", goal_id, ",".join(sorted(patch)))
        return {"changed": True, "goal": updated}

    return _write(ctx, fn)


# ---------- notes ----------

class NoteCreate(BaseModel):
    title: str = Field(default="", max_length=300)
    note: str = Field(default="", max_length=100000)
    pinned: bool = False


@router.post("/agent/notes", status_code=201)
def agent_create_note(body: NoteCreate, ctx: AgentCtx = Depends(agent_auth)):
    def fn(conn):
        now = _now_ms()
        note = {"id": _new_id(), "title": body.title, "note": body.note, "noteDoc": None,
                "pinned": body.pinned, "createdAt": now, "updatedAt": now}
        _apply(conn, ctx.user_id, "notes", note["id"], False, note)
        _audit(conn, ctx, "note.create", "notes", note["id"], body.title[:80])
        return note

    return _write(ctx, fn)


class NotePatch(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    note: str | None = Field(default=None, max_length=100000)
    pinned: bool | None = None


@router.patch("/agent/notes/{note_id}")
def agent_patch_note(note_id: str, body: NotePatch, ctx: AgentCtx = Depends(agent_auth)):
    given = body.model_fields_set

    def fn(conn):
        ent = _get(conn, ctx.user_id, "notes", note_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="note not found")
        note = ent["data"] | {"id": note_id}
        if "note" in given and note.get("noteDoc"):
            raise HTTPException(
                status_code=409,
                detail="this note has rich-text content; patching 'note' would desync it. Edit it in the app.",
            )
        patch = {f: getattr(body, f) for f in ("title", "note", "pinned") if f in given}
        if not patch:
            return {"changed": False, "note": note}
        updated = {**note, **patch, "updatedAt": _now_ms()}
        _apply(conn, ctx.user_id, "notes", note_id, False, updated)
        _audit(conn, ctx, "note.patch", "notes", note_id, ",".join(sorted(patch)))
        return {"changed": True, "note": updated}

    return _write(ctx, fn)


# ---------- journal ----------

class JournalPut(BaseModel):
    note: str | None = Field(default=None, max_length=100000)
    mood: int | None = Field(default=None, ge=1, le=5)
    highlight: str | None = Field(default=None, max_length=500)


@router.put("/agent/journal/{day}")
def agent_put_journal(day: str, body: JournalPut, ctx: AgentCtx = Depends(agent_auth)):
    day = _opt_date(day, "date")
    given = body.model_fields_set

    def fn(conn):
        rows = conn.execute(
            "SELECT id, data FROM entities WHERE user_id = ? AND collection = 'journal' AND deleted = 0",
            (ctx.user_id,),
        ).fetchall()
        entry = None
        for r in rows:
            d = json.loads(r["data"])
            if d.get("date") == day:
                entry = d | {"id": r["id"]}
                break
        now = _now_ms()
        created = False
        if entry is None:
            entry = {"id": _new_id(), "date": day, "note": "", "noteDoc": None,
                     "mood": None, "highlight": None, "createdAt": now, "updatedAt": now}
            created = True
        if "note" in given and body.note and entry.get("noteDoc"):
            raise HTTPException(
                status_code=409,
                detail="this entry has rich-text content; setting 'note' would desync it. Edit it in the app.",
            )
        patch = {f: getattr(body, f) for f in ("note", "mood", "highlight") if f in given}
        updated = {**entry, **patch, "updatedAt": now}
        _apply(conn, ctx.user_id, "journal", entry["id"], False, updated)
        _audit(conn, ctx, "journal.create" if created else "journal.update", "journal", entry["id"], day)
        return {"created": created, "entry": updated}

    return _write(ctx, fn)


# ---------- soft delete (tombstones only; cascades mirror the app) ----------

@router.delete("/agent/entities/{collection}/{entity_id}")
def agent_delete(collection: str, entity_id: str, ctx: AgentCtx = Depends(agent_auth)):
    if collection not in AGENT_COLLECTIONS:
        raise HTTPException(status_code=404, detail="unknown collection")

    def fn(conn):
        ent = _get(conn, ctx.user_id, collection, entity_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="not found")
        now = _now_ms()
        deleted_ids = [entity_id]

        def tombstone(col, eid):
            _apply(conn, ctx.user_id, col, eid, True, {})

        if collection == "tasks":
            # Mirror deleteTask: direct subtasks go too; dead blockedBy refs are stripped.
            tasks = _all(conn, ctx.user_id, "tasks")
            children = [t for t in tasks if t.get("parentId") == entity_id]
            gone = {entity_id, *[c["id"] for c in children]}
            deleted_ids = list(gone)
            tombstone("tasks", entity_id)
            for c in children:
                tombstone("tasks", c["id"])
            for t in tasks:
                refs = [b for b in (t.get("blockedBy") or []) if b in gone]
                if refs and t["id"] not in gone:
                    updated = {**t, "blockedBy": [b for b in t["blockedBy"] if b not in gone],
                               "updatedAt": now}
                    _apply(conn, ctx.user_id, "tasks", t["id"], False, updated)
        elif collection == "projects":
            # Mirror deleteProject: this project's own tasks (and their subtasks) go;
            # subprojects move up one level and stay intact (John-approved policy, Oct 27).
            project = ent["data"] | {"id": entity_id}
            tasks = _all(conn, ctx.user_id, "tasks")
            own = [t for t in tasks if t.get("projectId") == entity_id]
            own_ids = {t["id"] for t in own}
            children = [t for t in tasks if t.get("parentId") in own_ids]
            deleted_ids = [entity_id, *own_ids, *[t["id"] for t in children]]
            tombstone("projects", entity_id)
            for t in own + children:
                tombstone("tasks", t["id"])
            for p in _all(conn, ctx.user_id, "projects"):
                if (p.get("parentId") or None) == entity_id:
                    updated = {**p, "parentId": project.get("parentId") or None}
                    _apply(conn, ctx.user_id, "projects", p["id"], False, updated)
        elif collection == "notes":
            # Mirror deleteNote: tasks created from this note keep their text, drop the link.
            tombstone("notes", entity_id)
            for t in _all(conn, ctx.user_id, "tasks"):
                if t.get("noteId") == entity_id:
                    updated = {**t, "noteId": None, "updatedAt": now}
                    _apply(conn, ctx.user_id, "tasks", t["id"], False, updated)
        else:
            # habits (logs kept, harmless and recoverable), habitLogs, goals, journal.
            tombstone(collection, entity_id)

        _audit(conn, ctx, "entity.soft_delete", collection, entity_id,
               f"cascade={len(deleted_ids)}")
        return {"deleted": True, "tombstoned": deleted_ids}

    return _write(ctx, fn)
