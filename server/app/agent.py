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
import os
import json
import re
import secrets
import time
import uuid
from datetime import date, datetime, timedelta, timezone

from dateutil import rrule
from fastapi import APIRouter, Body, Depends, Header, HTTPException, Request, Response
from pydantic import BaseModel, Field, StrictInt

from .auth import current_user
from .db import DB_PATH, get_conn

router = APIRouter(prefix="/api")

SCOPES = ("read", "read-write")
MAX_TOKENS = 25  # bound on stored keys per user, not a request-rate limit

SCHEMA = """
CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('read','read-write')),
  project_id TEXT,  -- NULL = full access; else key is confined to this project's subtree
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

AGENT_COLLECTIONS = {"tasks", "projects", "habits", "habitLogs", "goals", "notes", "journal", "focusSessions", "attachments", "automationRules", "userRules", "deviceSettings"}


def init_agent_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA)
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(agent_tokens)")]
    if "project_id" not in cols:
        conn.execute("ALTER TABLE agent_tokens ADD COLUMN project_id TEXT")
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
    project_id: str | None = None


def agent_auth(authorization: str = Header(default="")) -> AgentCtx:
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len(prefix):].strip()
    conn = get_conn()
    row = conn.execute(
        "SELECT id, user_id, name, scope, project_id, revoked_at, last_used_at FROM agent_tokens WHERE token_hash = ?",
        (_hash(token),),
    ).fetchone()
    if row is None or row["revoked_at"] is not None:
        raise HTTPException(status_code=401, detail="invalid or revoked agent token")
    # Throttle the last-used write: reads should not each cost a DB write.
    stale = True
    if row["last_used_at"]:
        try:
            last_dt = datetime.strptime(row["last_used_at"], "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)
            stale = (datetime.now(timezone.utc) - last_dt).total_seconds() > 60
        except ValueError:
            stale = True
    if stale:
        conn.execute(
            "UPDATE agent_tokens SET last_used_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?",
            (row["id"],),
        )
        conn.commit()
    return AgentCtx(token_id=row["id"], user_id=row["user_id"], name=row["name"],
                    scope=row["scope"], project_id=row["project_id"])


def require_write(ctx: AgentCtx) -> None:
    if ctx.scope != "read-write":
        raise HTTPException(status_code=403, detail="this key is read-only")


def require_agent_write(authorization: str = Header(default="")) -> None:
    """Route-level dependency for mutating routes: runs before body validation,
    so a read-only key always gets 403, never a misleading 422."""
    require_write(agent_auth(authorization))


WRITE = [Depends(require_agent_write)]

_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


def _valid_color(c: str) -> str:
    if not _COLOR_RE.match(c):
        raise HTTPException(status_code=422, detail="color must be a hex color like #0f766e")
    return c.lower()


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
        "deleted_with=CASE WHEN excluded.deleted = 0 THEN NULL ELSE entities.deleted_with END, "
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
        (ctx.token_id, action, collection, entity_id, (detail if isinstance(detail, str) else repr(detail) if detail is not None else "")[:500]),
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
    """dateutil rruleset for an RRULE string with DTSTART; None when malformed.

    Client parity: rrule.js parses every datetime as UTC, so a naive DTSTART
    mixed with a UTC UNTIL (or the reverse) still evaluates. dateutil refuses
    the mix, which would silently stop agent-side completion from spawning
    (and 422 create/patch) for rules the client accepts - imported ICS feeds
    produce exactly this shape. Normalize by marking the naive side UTC too.
    """
    dtstart_naive = re.search(r"^DTSTART:(\d{8}T\d{6})(?!Z)\s*$", rule, re.M)
    until_z = re.search(r"UNTIL=\d{8}T\d{6}Z", rule)
    until_naive = re.search(r"UNTIL=(\d{8}T\d{6})(?!Z)", rule)
    if dtstart_naive and until_z:
        rule = re.sub(r"^(DTSTART:\d{8}T\d{6})(?!Z)(\s*)$", r"\1Z\2", rule, count=1, flags=re.M)
    elif until_naive and re.search(r"^DTSTART:\d{8}T\d{6}Z\s*$", rule, re.M):
        rule = re.sub(r"UNTIL=(\d{8}T\d{6})(?!Z)", r"UNTIL=\1Z", rule, count=1)
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


def _next_occurrence(rule: str, due_date: str, today: str) -> str | None:
    rr = _parse_rule(rule)
    if rr is None:
        return None
    base = max(due_date, today)
    # Clamp-path eligibility uses only the BYMONTHDAY written in the rule
    # string, matching the client's rr.origOptions check. dateutil derives
    # BYMONTHDAY from DTSTART when the string omits it; taking the clamp path
    # on that derived value would skip COUNT/UNTIL enforcement (rr.after is
    # bypassed) and spawn occurrences past the series end, which the client
    # never does.
    m = re.search(r"(?:^|[;\n])BYMONTHDAY=(-?[\d,]+)", rule)
    mdays = [int(x) for x in m.group(1).split(",")] if m else []
    if (
        rr._freq == rrule.MONTHLY
        and (rr._interval or 1) == 1
        and len(mdays) == 1
        and not rr._byweekday
        and not rr._bysetpos
    ):
        return _next_monthly_clamped(int(mdays[0]), base)
    y, m, d = int(base[:4]), int(base[5:7]), int(base[8:10])
    # Rules without a UTC (trailing-Z) DTSTART are naive; mixing a naive rule
    # with an aware anchor crashes rr.after(), so match the rule's awareness.
    aware = getattr(rr, "_dtstart", None) is not None and rr._dtstart.tzinfo is not None
    anchor = datetime(y, m, d, 12, 0, tzinfo=timezone.utc if aware else None)
    nxt = rr.after(anchor, inc=False)
    if nxt is None:
        return None
    return nxt.date().isoformat()


def next_occurrence_date(rule: str, due_date: str, today: str) -> str | None:
    """Port of the client's nextOccurrenceDate: next local date strictly after
    max(dueDate, today); malformed rules yield None so completion is never blocked.
    A rule that parses but cannot be evaluated also yields None here - the
    create/patch paths reject those up front via _check_rule_computable."""
    try:
        return _next_occurrence(rule, due_date, today)
    except (ValueError, TypeError, OverflowError):
        return None


def _check_rule_computable(rule: str) -> None:
    """422 for rules that parse but raise when evaluated (e.g. BYMINUTE=70)."""
    today = datetime.now(timezone.utc).date().isoformat()
    try:
        _next_occurrence(rule, today, today)
    except (ValueError, TypeError, OverflowError) as exc:
        raise HTTPException(status_code=422, detail=f"recurrence cannot be evaluated: {exc}")


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
    projectId: str | None = None  # set = key confined to that project's subtree


@router.post("/agent-tokens", status_code=201)
def create_token(body: TokenCreate, user_id: int = Depends(current_user)):
    if body.scope not in SCOPES:
        raise HTTPException(status_code=422, detail="scope must be 'read' or 'read-write'")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    conn = get_conn()
    if body.projectId is not None and _get(conn, user_id, "projects", body.projectId) is None:
        raise HTTPException(status_code=422, detail="projectId: no such project")
    active = conn.execute(
        "SELECT COUNT(*) AS n FROM agent_tokens WHERE user_id = ? AND revoked_at IS NULL", (user_id,)
    ).fetchone()["n"]
    if active >= MAX_TOKENS:
        raise HTTPException(status_code=409, detail=f"at most {MAX_TOKENS} active keys; revoke one first")
    token = "ldk_" + secrets.token_urlsafe(32)
    tid = _new_id()
    conn.execute(
        "INSERT INTO agent_tokens (id, user_id, name, scope, project_id, token_hash) VALUES (?, ?, ?, ?, ?, ?)",
        (tid, user_id, name, body.scope, body.projectId, _hash(token)),
    )
    conn.commit()
    row = conn.execute("SELECT created_at FROM agent_tokens WHERE id = ?", (tid,)).fetchone()
    return {"id": tid, "name": name, "scope": body.scope, "project_id": body.projectId, "projectId": body.projectId,
            "token": token, "created_at": row["created_at"]}


@router.get("/agent-tokens")
def list_tokens(user_id: int = Depends(current_user)):
    rows = get_conn().execute(
        "SELECT id, name, scope, project_id, created_at, last_used_at, revoked_at FROM agent_tokens "
        "WHERE user_id = ? ORDER BY created_at",
        (user_id,),
    ).fetchall()
    return {
        "tokens": [
            {k: r[k] for k in ("id", "name", "scope", "project_id", "created_at", "last_used_at", "revoked_at")}
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


# ---------- project scoping ----------

# A key with project_id set is confined to that project's subtree: tasks and
# focus sessions inside it, a read-only project tree for context, and nothing
# else - habits, goals, notes and journal are account-wide and stay out of
# reach, so a scoped key cannot touch data the owner did not delegate.


def _project_subtree(conn, user_id: int, root_id: str) -> set[str]:
    projects = _all(conn, user_id, "projects")
    kids: dict[str | None, list[str]] = {}
    for p in projects:
        kids.setdefault(p.get("parentId"), []).append(p["id"])
    out, frontier = {root_id}, [root_id]
    while frontier:
        cur = frontier.pop()
        for k in kids.get(cur, []):
            if k not in out:
                out.add(k)
                frontier.append(k)
    return out


def _scope_check_task(conn, ctx: AgentCtx, task: dict) -> None:
    if ctx.project_id is not None and task.get("projectId") not in _project_subtree(conn, ctx.user_id, ctx.project_id):
        raise HTTPException(status_code=404, detail="task not found")


def _scoped_ref_task(conn, ctx: AgentCtx, task_id: str | None, field: str) -> None:
    """A scoped key may only reference tasks inside its subtree; out-of-scope
    tasks stay invisible (404, same as reads)."""
    if task_id is None or ctx.project_id is None:
        return
    task = _get(conn, ctx.user_id, "tasks", task_id)
    if task is not None:
        _scope_check_task(conn, ctx, task["data"])


def _scoped_ref_global(ctx: AgentCtx, value, field: str) -> None:
    """goalId/noteId link account-wide collections a scoped key cannot see;
    setting them through a scoped key is refused, not just hidden."""
    if value is not None and ctx.project_id is not None:
        raise HTTPException(status_code=403, detail=f"{field}: account-wide collections are outside a project-scoped key")


def _scope_check_collection(ctx: AgentCtx, collection: str, read: bool = False) -> None:
    """Global collections are out of reach for project-scoped keys; the project
    tree itself is readable (agents need it for context) but not writable."""
    if ctx.project_id is None:
        return
    if collection in ("tasks", "focusSessions", "attachments"):
        return
    if collection == "projects" and read:
        return
    raise HTTPException(
        status_code=403,
        detail=f"this key is scoped to one project; {collection} is account-wide",
    )


# ---------- automation config ----------
# The app's two automation stores (Settings toggles and user-defined rules)
# are synced entities so every device and agent manages ONE configuration.
# Execution stays in the app - rules run only while Lifedash is open.

AUTOMATION_SINGLETON_ID = "settings"


def _validate_automation_rules(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="body must be an object")
    allowed = {"rollover", "completeParent"}
    unknown = sorted(set(payload) - allowed)
    if unknown:
        raise HTTPException(status_code=422, detail=f"unknown fields: {unknown}")
    for k in allowed:
        if k in payload and not isinstance(payload[k], bool):
            raise HTTPException(status_code=422, detail=f"{k} must be a boolean")
    return payload


@router.get("/agent/settings/automation")
def agent_get_automation(ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "automationRules", read=True)
    conn = get_conn()
    ent = _get(conn, ctx.user_id, "automationRules", AUTOMATION_SINGLETON_ID)
    data = ent["data"] if ent else {}
    return {"rules": {"rollover": bool(data.get("rollover", False)),
                      "completeParent": bool(data.get("completeParent", False))}}


@router.put("/agent/settings/automation", dependencies=WRITE)
def agent_put_automation(body: dict = Body(...), ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "automationRules")
    patch = _validate_automation_rules(body)

    def fn(conn):
        ent = _get(conn, ctx.user_id, "automationRules", AUTOMATION_SINGLETON_ID)
        merged = {"id": AUTOMATION_SINGLETON_ID, "rollover": False, "completeParent": False,
                  **(ent["data"] if ent else {}), **patch}
        rev = _apply(conn, ctx.user_id, "automationRules", AUTOMATION_SINGLETON_ID, False, merged)
        _audit(conn, ctx, "settings.automation", "automationRules", AUTOMATION_SINGLETON_ID, patch)
        return {"rev": rev, "rules": {"rollover": merged["rollover"], "completeParent": merged["completeParent"]}}

    return _write(ctx, fn)


# ---------- per-device settings ----------
# Appearance and reminder preferences are per device, and agents may
# manage them on a SPECIFIC device (Owner decision, Oct 29). The app
# keeps a localStorage cache for synchronous boot and mirrors each
# device's set into a deviceSettings entity keyed by device id; the
# device applies changes on its next sync pull. Custom wallpaper IMAGES
# never ride sync - wallpaper is id + intensity only. Project-scoped
# keys get 403: device settings are account-wide.

DEVICE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,64}$")
_THEMES = {"light", "dark", "system"}
_STYLES = {"paper", "terminal", "editorial", "soft", "contrast", "nexus", "compact", "polar", "modern-dark", "playful-geometric", "cyberpunk", "luxury", "professional", "retro", "sketch", "monochrome"}
_FONTS = {"style", "inter", "manrope", "geist", "source-sans", "dm-sans", "plex", "system", "serif", "mono"}
_WALLPAPERS = {"none", "aurora", "sand", "blue", "custom"}
_DEVICE_FIELDS = ("theme", "style", "font", "wallpaper", "remindersEnabled", "journalPromptEnabled")


def _clean_wallpaper(w) -> dict | None:
    if not isinstance(w, dict) or set(w) - {"id", "intensity"}:
        return None
    if w.get("id") not in _WALLPAPERS:
        return None
    intensity = w.get("intensity")
    if not isinstance(intensity, int) or isinstance(intensity, bool) or not 0 <= intensity <= 35:
        return None
    return {"id": w["id"], "intensity": intensity}


def _label_view(value) -> str | None:
    # Bounded display string for the device listing, whatever was pushed.
    return value[:120] if isinstance(value, str) else None


def _settings_view(data: dict) -> dict:
    # Display normalization only. Rows pushed through sync by the owner's own
    # client are trusted like every collection's rows, but a buggy client can
    # write malformed shapes - never relay those to API consumers. The stored
    # row is untouched.
    out = {}
    for field, values in (("theme", _THEMES), ("style", _STYLES), ("font", _FONTS)):
        v = data.get(field)
        if isinstance(v, str) and v in values:
            out[field] = v
    w = _clean_wallpaper(data.get("wallpaper"))
    if w is not None:
        out["wallpaper"] = w
    for field in ("remindersEnabled", "journalPromptEnabled"):
        if isinstance(data.get(field), bool):
            out[field] = data[field]
    return out


def _validate_device_settings(payload: dict) -> dict:
    if not isinstance(payload, dict):
        raise HTTPException(status_code=422, detail="body must be an object")
    unknown = sorted(set(payload) - set(_DEVICE_FIELDS))
    if unknown:
        if "image" in unknown:
            raise HTTPException(status_code=422, detail="wallpaper image data stays on the device; set wallpaper by id")
        raise HTTPException(status_code=422, detail=f"unknown fields: {unknown}")
    patch = {}
    for field, values in (("theme", _THEMES), ("style", _STYLES), ("font", _FONTS)):
        if field in payload:
            if payload[field] not in values:
                raise HTTPException(status_code=422, detail=f"{field} must be one of {sorted(values)}")
            patch[field] = payload[field]
    if "wallpaper" in payload:
        w = _clean_wallpaper(payload["wallpaper"])
        if w is None:
            raise HTTPException(status_code=422, detail='wallpaper must be {"id": known id, "intensity": integer 0-35}')
        patch["wallpaper"] = w
    for field in ("remindersEnabled", "journalPromptEnabled"):
        if field in payload:
            if not isinstance(payload[field], bool):
                raise HTTPException(status_code=422, detail=f"{field} must be a boolean")
            patch[field] = payload[field]
    return patch


def _check_device_id(device_id: str) -> str:
    if not DEVICE_ID_RE.match(device_id):
        raise HTTPException(status_code=422, detail="invalid device id")
    return device_id


@router.get("/agent/devices")
def agent_list_devices(ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "deviceSettings", read=True)
    conn = get_conn()
    devices = [
        {"deviceId": d["id"], "label": _label_view(d.get("label")), "updatedAt": d.get("updatedAt"),
         "settings": _settings_view(d)}
        for d in _all(conn, ctx.user_id, "deviceSettings")
    ]
    return {"devices": devices}


@router.get("/agent/devices/{device_id}/settings")
def agent_get_device_settings(device_id: str, ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "deviceSettings", read=True)
    conn = get_conn()
    ent = _get(conn, ctx.user_id, "deviceSettings", _check_device_id(device_id))
    if ent is None:
        raise HTTPException(status_code=404, detail="device not found")
    return {"deviceId": device_id, "label": _label_view(ent["data"].get("label")),
            "updatedAt": ent["data"].get("updatedAt"), "settings": _settings_view(ent["data"])}


@router.put("/agent/devices/{device_id}/settings", dependencies=WRITE)
def agent_put_device_settings(device_id: str, body: dict = Body(...), ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "deviceSettings")
    _check_device_id(device_id)
    patch = _validate_device_settings(body)
    if not patch:
        raise HTTPException(status_code=422, detail="empty update: no settings fields")

    def fn(conn):
        # The device must exist and be live: unknown ids and tombstones are
        # 404. A deleted device stays deleted - its re-pushes conflict
        # server-wins against the tombstone until an explicit restore
        # (generic restore endpoint) revives the row with its payload.
        ent = _get(conn, ctx.user_id, "deviceSettings", device_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="device not found")
        merged = {**ent["data"], **patch,
                  "id": device_id, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        rev = _apply(conn, ctx.user_id, "deviceSettings", device_id, False, merged)
        _audit(conn, ctx, "settings.device", "deviceSettings", device_id, patch)
        return {"rev": rev, "deviceId": device_id, "settings": _settings_view(merged)}

    return _write(ctx, fn)


def _validate_user_rule(payload: dict, existing: dict | None) -> dict:
    base = dict(existing) if existing else {}
    for k, v in (payload or {}).items():
        if k not in ("trigger", "title", "lastFired"):
            raise HTTPException(status_code=422, detail=f"unknown field: {k}")
        base[k] = v
    trg = base.get("trigger")
    if not isinstance(trg, dict):
        raise HTTPException(status_code=422, detail="trigger is required: {kind: tag|weekly, ...}")
    kind = trg.get("kind")
    if kind == "tag":
        tag = trg.get("tag")
        if not isinstance(tag, str) or not tag.strip():
            raise HTTPException(status_code=422, detail="tag trigger requires a non-empty tag")
        base["trigger"] = {"kind": "tag", "tag": tag.strip().lstrip("#")}
    elif kind == "weekly":
        try:
            wd = int(trg.get("weekday"))
        except (TypeError, ValueError):
            raise HTTPException(status_code=422, detail="weekly trigger requires weekday 0-6 (0=Sunday)")
        if isinstance(trg.get("weekday"), bool) or not 0 <= wd <= 6:
            raise HTTPException(status_code=422, detail="weekday must be 0-6 (0=Sunday)")
        base["trigger"] = {"kind": "weekly", "weekday": wd}
    else:
        raise HTTPException(status_code=422, detail="trigger.kind must be 'tag' or 'weekly'")
    title = base.get("title")
    if not isinstance(title, str) or not title.strip():
        raise HTTPException(status_code=422, detail="title is required (rules create a task with this title)")
    base["title"] = title.strip()
    lf = base.get("lastFired")
    if lf is not None:
        if not isinstance(lf, str) or not _valid_date(lf):
            raise HTTPException(status_code=422, detail="lastFired must be a YYYY-MM-DD date or null")
    base["lastFired"] = lf
    return base


@router.post("/agent/user-rules", status_code=201, dependencies=WRITE)
def agent_create_user_rule(body: dict = Body(...), ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "userRules")
    data = _validate_user_rule(body, None)
    data.setdefault("createdAt", _now_ms())

    def fn(conn):
        rid = _new_id()
        data["id"] = rid
        rev = _apply(conn, ctx.user_id, "userRules", rid, False, data)
        _audit(conn, ctx, "user_rule.create", "userRules", rid, {"title": data["title"]})
        return {"id": rid, "rev": rev, "data": data}

    return _write(ctx, fn)


@router.patch("/agent/user-rules/{rule_id}", dependencies=WRITE)
def agent_patch_user_rule(rule_id: str, body: dict = Body(...), ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "userRules")

    def fn(conn):
        ent = _get(conn, ctx.user_id, "userRules", rule_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="not found")
        data = _validate_user_rule(body, ent["data"])
        data["id"] = rule_id
        rev = _apply(conn, ctx.user_id, "userRules", rule_id, False, data)
        _audit(conn, ctx, "user_rule.patch", "userRules", rule_id, body)
        return {"id": rule_id, "rev": rev, "data": data}

    return _write(ctx, fn)


# ---------- read endpoints (agent auth, any scope) ----------

@router.get("/agent/collections")
def agent_collections(ctx: AgentCtx = Depends(agent_auth)):
    conn = get_conn()
    if ctx.project_id is not None:
        tree = _project_subtree(conn, ctx.user_id, ctx.project_id)
        tasks = [t for t in _all(conn, ctx.user_id, "tasks") if t.get("projectId") in tree]
        task_proj = {t["id"]: t.get("projectId") for t in _all(conn, ctx.user_id, "tasks")}
        sessions = [s for s in _all(conn, ctx.user_id, "focusSessions")
                    if task_proj.get(s.get("taskId")) in tree]
        return {"collections": {"tasks": len(tasks), "projects": len(tree),
                                "focusSessions": len(sessions)}}
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
    _scope_check_collection(ctx, collection, read=True)
    limit = max(1, min(limit, 5000))
    offset = max(0, offset)
    where = "" if include_deleted else "AND deleted = 0"
    conn = get_conn()
    rows = conn.execute(
        f"SELECT id, deleted, data FROM entities WHERE user_id = ? AND collection = ? {where} "
        "ORDER BY id",
        (ctx.user_id, collection),
    ).fetchall()
    if ctx.project_id is not None and collection in ("tasks", "focusSessions", "attachments", "projects"):
        tree = _project_subtree(conn, ctx.user_id, ctx.project_id)
        if collection == "tasks":
            rows = [r for r in rows if json.loads(r["data"]).get("projectId") in tree]
        elif collection == "projects":
            # A scoped key sees only its own subtree, never other project names.
            rows = [r for r in rows if r["id"] in tree]
        else:
            task_proj = {t["id"]: t.get("projectId") for t in _all(conn, ctx.user_id, "tasks")}
            rows = [r for r in rows if task_proj.get(json.loads(r["data"]).get("taskId")) in tree]
    rows = rows[offset:offset + limit]
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
    _scope_check_collection(ctx, collection, read=True)
    conn = get_conn()
    ent = _get(conn, ctx.user_id, collection, entity_id, include_deleted=True)
    if ent is None:
        raise HTTPException(status_code=404, detail="not found")
    if ctx.project_id is not None:
        if collection == "tasks":
            _scope_check_task(conn, ctx, ent["data"])
        elif collection == "projects":
            if ent["id"] not in _project_subtree(conn, ctx.user_id, ctx.project_id):
                raise HTTPException(status_code=404, detail="not found")
        elif collection in ("focusSessions", "attachments"):
            task = _get(conn, ctx.user_id, "tasks", ent["data"].get("taskId"))
            _scope_check_task(conn, ctx, task["data"] if task else {})
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


@router.post("/agent/tasks", status_code=201, dependencies=WRITE)
def agent_create_task(body: TaskCreate, ctx: AgentCtx = Depends(agent_auth)):
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="title must not be blank")
    due_date = _opt_date(body.dueDate, "dueDate")
    due_time = _opt_time(body.dueTime, "dueTime")
    if body.recurrence is not None:
        if _parse_rule(body.recurrence) is None:
            raise HTTPException(status_code=422, detail="recurrence is not a valid RRULE string")
        _check_rule_computable(body.recurrence)

    def fn(conn):
        project_id = body.projectId or "inbox"
        if ctx.project_id is not None and project_id not in _project_subtree(conn, ctx.user_id, ctx.project_id):
            raise HTTPException(status_code=403, detail="outside this key's project scope")
        _scoped_ref_task(conn, ctx, body.parentId, "parentId")
        _scoped_ref_global(ctx, body.goalId, "goalId")
        _scoped_ref_global(ctx, body.noteId, "noteId")
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


@router.post("/agent/tasks/{task_id}/complete", dependencies=WRITE)
def agent_complete_task(task_id: str, body: CompleteBody | None = None, ctx: AgentCtx = Depends(agent_auth)):
    today = _today_or(body.today if body else None)

    def fn(conn):
        ent = _get(conn, ctx.user_id, "tasks", task_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="task not found")
        task = ent["data"] | {"id": task_id}
        _scope_check_task(conn, ctx, task)
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


@router.post("/agent/tasks/{task_id}/uncomplete", dependencies=WRITE)
def agent_uncomplete_task(task_id: str, ctx: AgentCtx = Depends(agent_auth)):
    def fn(conn):
        ent = _get(conn, ctx.user_id, "tasks", task_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="task not found")
        task = ent["data"] | {"id": task_id}
        _scope_check_task(conn, ctx, task)
        if task.get("status") != "done":
            _audit(conn, ctx, "task.uncomplete.noop", "tasks", task_id, f"status={task.get('status')}")
            return {"changed": False, "task": task}
        # Mirrors the client: the already-spawned next occurrence stays.
        updated = {**task, "status": "active", "completedAt": None, "updatedAt": _now_ms()}
        _apply(conn, ctx.user_id, "tasks", task_id, False, updated)
        _audit(conn, ctx, "task.uncomplete", "tasks", task_id)
        return {"changed": True, "task": updated}

    return _write(ctx, fn)


@router.post("/agent/tasks/{task_id}/skip", dependencies=WRITE)
def agent_skip_task(task_id: str, body: CompleteBody | None = None, ctx: AgentCtx = Depends(agent_auth)):
    today = _today_or(body.today if body else None)

    def fn(conn):
        ent = _get(conn, ctx.user_id, "tasks", task_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="task not found")
        task = ent["data"] | {"id": task_id}
        _scope_check_task(conn, ctx, task)
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


@router.patch("/agent/tasks/{task_id}", dependencies=WRITE)
def agent_patch_task(task_id: str, body: TaskPatch, ctx: AgentCtx = Depends(agent_auth)):
    # model_fields_set distinguishes "field absent" from "explicitly null",
    # so agents can clear a due date or un-parent a task.
    given = body.model_fields_set
    # Null clears nullable-by-design fields (dates, parent, goal, recurrence);
    # for the rest, null would corrupt the record - omit the field instead.
    for f in ("title", "note", "projectId", "priority", "pinned", "status", "tags", "blockedBy"):
        if f in given and getattr(body, f) is None:
            raise HTTPException(status_code=422, detail=f"{f} cannot be null; omit the field to leave it unchanged")
    if body.status is not None and body.status not in ("archived", "active"):
        raise HTTPException(status_code=422, detail="status changes use /complete or /uncomplete; only 'archived' and 'active' (un-archive) may be patched")
    for f in ("dueDate", "plannedDate"):
        if f in given:
            _opt_date(getattr(body, f), f)
    for f in ("dueTime", "plannedTime"):
        if f in given:
            _opt_time(getattr(body, f), f)
    if "recurrence" in given and body.recurrence is not None:
        if _parse_rule(body.recurrence) is None:
            raise HTTPException(status_code=422, detail="recurrence is not a valid RRULE string")
        _check_rule_computable(body.recurrence)
    if "title" in given and (body.title is None or not body.title.strip()):
        raise HTTPException(status_code=422, detail="title must not be blank")

    def fn(conn):
        ent = _get(conn, ctx.user_id, "tasks", task_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="task not found")
        task = ent["data"] | {"id": task_id}
        _scope_check_task(conn, ctx, task)
        if "status" in given and body.status == "active" and task.get("status") != "archived":
            raise HTTPException(status_code=422, detail="only an archived task can be un-archived via status; use /uncomplete for done tasks")
        if "projectId" in given:
            _require_entity(conn, ctx.user_id, "projects", body.projectId, "projectId")
            if ctx.project_id is not None and body.projectId not in _project_subtree(conn, ctx.user_id, ctx.project_id):
                raise HTTPException(status_code=403, detail="outside this key's project scope")
        if "goalId" in given:
            _scoped_ref_global(ctx, body.goalId, "goalId")
            _require_entity(conn, ctx.user_id, "goals", body.goalId, "goalId")
        if "parentId" in given and body.parentId is not None:
            _require_entity(conn, ctx.user_id, "tasks", body.parentId, "parentId")
            _scoped_ref_task(conn, ctx, body.parentId, "parentId")
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
                _scoped_ref_task(conn, ctx, b, "blockedBy")
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
    weekdays: list[StrictInt] | None = None  # null = every day; else weekday numbers (0=Sun)


def _valid_weekdays(w):
    if w is None:
        return None
    if not all(isinstance(d, int) and 0 <= d <= 6 for d in w) or len(set(w)) != len(w) or not w:
        raise HTTPException(status_code=422, detail="weekdays must be distinct numbers 0-6 (0=Sun), or null for every day")
    return w


@router.post("/agent/habits", status_code=201, dependencies=WRITE)
def agent_create_habit(body: HabitCreate, ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "habits")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    weekdays = _valid_weekdays(body.weekdays)
    body.color = _valid_color(body.color)

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
    weekdays: list[StrictInt] | None = None
    archived: bool | None = None


@router.patch("/agent/habits/{habit_id}", dependencies=WRITE)
def agent_patch_habit(habit_id: str, body: HabitPatch, ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "habits")
    given = body.model_fields_set
    for f in ("name", "color", "archived"):
        if f in given and getattr(body, f) is None:
            raise HTTPException(status_code=422, detail=f"{f} cannot be null; omit the field to leave it unchanged")
    if "weekdays" in given:
        _valid_weekdays(body.weekdays)
    if "name" in given and not body.name.strip():
        raise HTTPException(status_code=422, detail="name must not be blank")
    if "color" in given:
        body.color = _valid_color(body.color)

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
    _scope_check_collection(ctx, "habits")
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


@router.post("/agent/habits/{habit_id}/check", dependencies=WRITE)
def agent_check_habit(habit_id: str, body: CheckBody, ctx: AgentCtx = Depends(agent_auth)):
    return _set_habit_log(ctx, habit_id, body, True)


@router.post("/agent/habits/{habit_id}/uncheck", dependencies=WRITE)
def agent_uncheck_habit(habit_id: str, body: CheckBody, ctx: AgentCtx = Depends(agent_auth)):
    return _set_habit_log(ctx, habit_id, body, False)


# ---------- projects ----------

class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    color: str = Field(default="#0f766e", max_length=32)
    parentId: str | None = None


@router.post("/agent/projects", status_code=201, dependencies=WRITE)
def agent_create_project(body: ProjectCreate, ctx: AgentCtx = Depends(agent_auth)):
    if ctx.project_id is not None and body.parentId is None:
        raise HTTPException(status_code=403,
                            detail="this key is scoped to one project; new projects need a parentId inside it")
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="name must not be blank")
    body.color = _valid_color(body.color)

    def fn(conn):
        projects = _all(conn, ctx.user_id, "projects")
        if body.parentId is not None and not any(p["id"] == body.parentId for p in projects):
            raise HTTPException(status_code=422, detail="parentId: no such project")
        if ctx.project_id is not None and body.parentId not in _project_subtree(conn, ctx.user_id, ctx.project_id):
            # Same response as a nonexistent parent: no scope oracle.
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


@router.patch("/agent/projects/{project_id}", dependencies=WRITE)
def agent_patch_project(project_id: str, body: ProjectPatch, ctx: AgentCtx = Depends(agent_auth)):
    given = body.model_fields_set
    for f in ("name", "color", "archived"):
        if f in given and getattr(body, f) is None:
            raise HTTPException(status_code=422, detail=f"{f} cannot be null; omit the field to leave it unchanged")
    if "name" in given and not body.name.strip():
        raise HTTPException(status_code=422, detail="name must not be blank")
    if "color" in given:
        body.color = _valid_color(body.color)

    def fn(conn):
        ent = _get(conn, ctx.user_id, "projects", project_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="project not found")
        if ctx.project_id is not None:
            tree = _project_subtree(conn, ctx.user_id, ctx.project_id)
            if project_id not in tree:
                raise HTTPException(status_code=404, detail="project not found")
            if project_id == ctx.project_id:
                raise HTTPException(status_code=403,
                                    detail="this key's root project is shared context and read-only")
        project = ent["data"] | {"id": project_id}
        patch = {}
        for f in ("name", "color", "archived"):
            if f in given:
                v = getattr(body, f)
                patch[f] = v.strip() if f == "name" and v else v
        if "parentId" in given:
            if ctx.project_id is not None:
                if body.parentId is None:
                    raise HTTPException(status_code=422,
                                        detail="cannot move a project out of this key's scope")
                if body.parentId not in _project_subtree(conn, ctx.user_id, ctx.project_id):
                    raise HTTPException(status_code=422, detail="parentId: no such project")
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


@router.post("/agent/goals", status_code=201, dependencies=WRITE)
def agent_create_goal(body: GoalCreate, ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "goals")
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


@router.patch("/agent/goals/{goal_id}", dependencies=WRITE)
def agent_patch_goal(goal_id: str, body: GoalPatch, ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "goals")
    given = body.model_fields_set
    if "title" in given and (body.title is None or not body.title.strip()):
        raise HTTPException(status_code=422, detail="title must not be blank")
    if "targetDate" in given:
        _opt_date(body.targetDate, "targetDate")
    for f in ("title", "note", "status", "habitIds", "projectIds"):
        if f in given and getattr(body, f) is None:
            raise HTTPException(status_code=422, detail=f"{f} cannot be null; omit the field to leave it unchanged")
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


@router.post("/agent/notes", status_code=201, dependencies=WRITE)
def agent_create_note(body: NoteCreate, ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "notes")
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


@router.patch("/agent/notes/{note_id}", dependencies=WRITE)
def agent_patch_note(note_id: str, body: NotePatch, ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "notes")
    given = body.model_fields_set
    for f in ("title", "note", "pinned"):
        if f in given and getattr(body, f) is None:
            raise HTTPException(status_code=422, detail=f"{f} cannot be null; omit the field to leave it unchanged")

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


@router.put("/agent/journal/{day}", dependencies=WRITE)
def agent_put_journal(day: str, body: JournalPut, ctx: AgentCtx = Depends(agent_auth)):
    _scope_check_collection(ctx, "journal")
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


# ---------- focus sessions ----------

_MIN_STARTED_AT = 1577836800000  # 2020-01-01; earlier values are data errors


class FocusSessionCreate(BaseModel):
    taskId: str
    startedAt: int  # ms epoch
    endedAt: int    # ms epoch; completed sessions only - live timers stay on the device
    seconds: int = Field(ge=0)


@router.post("/agent/focus-sessions", status_code=201, dependencies=WRITE)
def agent_log_focus_session(body: FocusSessionCreate, ctx: AgentCtx = Depends(agent_auth)):
    if body.startedAt < _MIN_STARTED_AT:
        raise HTTPException(status_code=422, detail="startedAt looks wrong (before 2020)")
    if body.endedAt <= body.startedAt:
        raise HTTPException(status_code=422, detail="endedAt must be after startedAt")
    elapsed = (body.endedAt - body.startedAt) // 1000
    if body.seconds > elapsed:
        raise HTTPException(status_code=422, detail="seconds cannot exceed the startedAt..endedAt span")
    now = _now_ms()
    if body.endedAt > now + 5 * 60 * 1000:
        raise HTTPException(status_code=422, detail="endedAt is in the future")

    def fn(conn):
        task = _require_entity(conn, ctx.user_id, "tasks", body.taskId, "taskId")
        _scope_check_task(conn, ctx, task["data"])
        session = {"id": _new_id(), "taskId": body.taskId, "startedAt": body.startedAt,
                   "endedAt": body.endedAt, "seconds": body.seconds}
        _apply(conn, ctx.user_id, "focusSessions", session["id"], False, session)
        _audit(conn, ctx, "focus.log", "focusSessions", session["id"], f"seconds={body.seconds}")
        return session

    return _write(ctx, fn)


# ---------- attachments (metadata entity + blob bytes) ----------

# Metadata lives in the "attachments" collection so it syncs like everything
# else; the blob bytes live on the server's disk and are fetched explicitly.
# Blobs are retained on delete, like tombstone payloads: restore brings the
# whole attachment back. Quotas are deliberate defaults, tunable by the
# operator: SYNC_ATTACHMENT_QUOTA_MB (200 per account) and
# SYNC_ATTACHMENT_MAX_FILE_MB (25 per file).

_BLOB_DIR = os.environ.get("SYNC_BLOB_DIR") or os.path.join(os.path.dirname(DB_PATH), "blobs")
_FILENAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


def _quota_bytes() -> tuple[int, int]:
    quota_mb = int(os.environ.get("SYNC_ATTACHMENT_QUOTA_MB", "200"))
    max_file_mb = int(os.environ.get("SYNC_ATTACHMENT_MAX_FILE_MB", "25"))
    return quota_mb * 1024 * 1024, max_file_mb * 1024 * 1024


_ATTACHMENT_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")


def _check_blob_id(attachment_id: str) -> None:
    """Blob paths are built from the id: refuse anything that is not a plain
    safe filename ('.', '..', separators, control chars never reach disk)."""
    if not _ATTACHMENT_ID_RE.match(attachment_id):
        raise HTTPException(status_code=404, detail="not found")


def _blob_path(user_id: int, attachment_id: str) -> str:
    return os.path.join(_BLOB_DIR, str(user_id), attachment_id)


def _disk_usage(user_id: int) -> int:
    """Quota is measured from the blobs actually on disk, never from
    client-supplied byteSize metadata, which a session client can poison."""
    d = os.path.join(_BLOB_DIR, str(user_id))
    total = 0
    try:
        for entry in os.scandir(d):
            if entry.is_file() and not entry.name.endswith(".tmp"):
                total += entry.stat().st_size
    except FileNotFoundError:
        pass
    return total


def attachment_auth(authorization: str = Header(default="")) -> tuple[int, AgentCtx | None]:
    """Dual auth for blob routes: the app's session token, or an agent key."""
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len(prefix):].strip()
    from .auth import _is_digest, hash_token
    row = get_conn().execute("SELECT user_id FROM tokens WHERE token = ?", (hash_token(token),)).fetchone()
    if row is None and not _is_digest(token):  # legacy plaintext session row
        row = get_conn().execute("SELECT user_id FROM tokens WHERE token = ?", (token,)).fetchone()
    if row is not None:
        return row["user_id"], None
    agent = agent_auth(authorization)
    return agent.user_id, agent


def _blob_write(user_id: int, ctx: AgentCtx | None, fn):
    """_write equivalent for dual-auth routes: scope check only for agent keys."""
    if ctx is not None:
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


@router.post("/attachments", status_code=201)
async def upload_attachment(request: Request, task_id: str, filename: str, id: str | None = None,
                            auth: tuple[int, AgentCtx | None] = Depends(attachment_auth)):
    """Upload a blob + its metadata in one call.

    The app passes its local attachment id so the Dexie row and the server
    entity converge on one identity; a retry of the same id with the same
    bytes returns the existing entity instead of duplicating it."""
    user_id, ctx = auth
    if ctx is not None:
        require_write(ctx)
    filename = _FILENAME_RE.sub("_", os.path.basename(filename))[:200] or "file"
    mime = (request.headers.get("content-type") or "application/octet-stream").split(";")[0][:100]
    quota, max_file = _quota_bytes()
    chunks = bytearray()
    async for chunk in request.stream():
        chunks += chunk
        if len(chunks) > max_file:
            # Machine-readable reason: per-file-size refusals need attention
            # (automatic retry cannot help until server config changes),
            # unlike storage-quota 413s, which can heal when space frees.
            raise HTTPException(status_code=413, detail={"reason": "attachment_file_too_large", "max_file_mb": max_file // (1024 * 1024)})
    body = bytes(chunks)
    if not body:
        raise HTTPException(status_code=422, detail="empty upload")
    if id is not None and not _ATTACHMENT_ID_RE.match(id):
        raise HTTPException(status_code=422, detail="id must be a plain safe filename")
    att_id = id or _new_id()
    path = _blob_path(user_id, att_id)
    digest = hashlib.sha256(body).hexdigest()

    def fn(conn):
        task = _require_entity(conn, user_id, "tasks", task_id, "task_id")
        if ctx is not None:
            _scope_check_task(conn, ctx, task["data"])
        row = conn.execute(
            "SELECT rev, deleted, data FROM entities WHERE user_id = ? AND collection = 'attachments' AND id = ?",
            (user_id, att_id),
        ).fetchone()
        if row is not None and not row["deleted"]:
            existing = json.loads(row["data"])
            has_blob = os.path.exists(path)
            if has_blob and existing.get("sha256") == digest:
                # Idempotent retry of the same upload.
                return existing | {"rev": row["rev"]}
            if existing.get("taskId") != task_id:
                raise HTTPException(status_code=409, detail="an attachment with this id already exists")
            if has_blob or (existing.get("sha256") and existing.get("sha256") != digest):
                raise HTTPException(status_code=409, detail="an attachment with this id already exists")
            # Metadata arrived first (sync push) and no blob is on disk yet:
            # this upload completes the row the client already announced.
            used = _disk_usage(user_id)
            if used + len(body) > quota:
                raise HTTPException(status_code=413, detail={"reason": "attachment_quota_exceeded", "quota_mb": quota // (1024 * 1024)})
            completed = {**existing, "sha256": digest, "byteSize": len(body),
                         "blobOnServer": True,
                         "name": existing.get("name") or filename,
                         "mime": existing.get("mime") or mime}
            rev = _apply(conn, user_id, "attachments", att_id, False, completed)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            tmp = path + ".tmp"
            with open(tmp, "wb") as f:
                f.write(body)
            wrote["tmp"] = True
            os.replace(tmp, path)
            wrote["blob"] = True
            return completed | {"rev": rev}
        # Retained tombstones still occupy disk, so they count against the
        # quota; otherwise upload+delete loops would bypass it. Measured
        # from real files: client-pushed byteSize metadata is untrusted.
        used = _disk_usage(user_id)
        if used + len(body) > quota:
            raise HTTPException(status_code=413, detail={"reason": "attachment_quota_exceeded", "quota_mb": quota // (1024 * 1024)})
        att = {"id": att_id, "taskId": task_id, "name": filename, "mime": mime,
               "byteSize": len(body), "sha256": digest, "createdAt": _now_ms(),
               "blobOnServer": True}
        rev = _apply(conn, user_id, "attachments", att_id, False, att)
        if ctx is not None:
            _audit(conn, ctx, "attachment.upload", "attachments", att_id, f"{filename} {len(body)}B")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "wb") as f:
            f.write(body)
        wrote["tmp"] = True
        os.replace(tmp, path)
        wrote["blob"] = True
        return att | {"rev": rev}

    wrote = {"tmp": False, "blob": False}
    try:
        return _blob_write(user_id, ctx, fn)
    except Exception:
        # The entity rolled back: never leave an orphaned blob behind. Only
        # remove what THIS request wrote - with a client-supplied id the
        # path can belong to a pre-existing entity (e.g. a 409 retry).
        for key, p in (("blob", path), ("tmp", path + ".tmp")):
            if wrote[key]:
                try:
                    os.unlink(p)
                except OSError:
                    pass
        raise


@router.get("/attachments/{attachment_id}/content")
def download_attachment(attachment_id: str, auth: tuple[int, AgentCtx | None] = Depends(attachment_auth)):
    user_id, ctx = auth
    _check_blob_id(attachment_id)
    conn = get_conn()
    ent = _get(conn, user_id, "attachments", attachment_id)
    if ent is None:
        raise HTTPException(status_code=404, detail="not found")
    if ctx is not None:
        task = _get(conn, ctx.user_id, "tasks", ent["data"].get("taskId"))
        _scope_check_task(conn, ctx, task["data"] if task else {})
    path = _blob_path(user_id, attachment_id)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="blob is missing on the server")
    with open(path, "rb") as f:
        content = f.read()
    name = ent["data"].get("name") or "file"
    return Response(
        content=content,
        media_type=ent["data"].get("mime") or "application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"',
                 "X-Content-Type-Options": "nosniff"},
    )


@router.delete("/attachments/{attachment_id}", status_code=204)
def delete_attachment(attachment_id: str, auth: tuple[int, AgentCtx | None] = Depends(attachment_auth)):
    user_id, ctx = auth
    _check_blob_id(attachment_id)
    if ctx is not None:
        require_write(ctx)
    conn = get_conn()
    ent = _get(conn, user_id, "attachments", attachment_id)
    if ent is None:
        raise HTTPException(status_code=404, detail="not found")
    if ctx is not None:
        task = _get(conn, ctx.user_id, "tasks", ent["data"].get("taskId"))
        _scope_check_task(conn, ctx, task["data"] if task else {})

    def fn(conn):
        _apply(conn, user_id, "attachments", attachment_id, True, ent["data"])
        if ctx is not None:
            _audit(conn, ctx, "attachment.delete", "attachments", attachment_id)
        return None

    # The blob file is retained so restore recovers the whole attachment.
    return _blob_write(user_id, ctx, fn)


# ---------- soft delete (tombstones only; cascades mirror the app) ----------

@router.delete("/agent/entities/{collection}/{entity_id}", dependencies=WRITE)
def agent_delete(collection: str, entity_id: str, ctx: AgentCtx = Depends(agent_auth)):
    if collection not in AGENT_COLLECTIONS:
        raise HTTPException(status_code=404, detail="unknown collection")

    if collection == "projects" and entity_id == "inbox":
        raise HTTPException(status_code=422, detail="the Inbox project cannot be deleted")

    _scope_check_collection(ctx, collection)

    def fn(conn):
        ent = _get(conn, ctx.user_id, collection, entity_id)
        if ent is None:
            raise HTTPException(status_code=404, detail="not found")
        if collection == "tasks":
            _scope_check_task(conn, ctx, ent["data"])
        now = _now_ms()
        deleted_ids = [entity_id]

        def tombstone(col, eid, cascade_root=None):
            # Soft delete keeps the payload: the server copy stays fully
            # recoverable (soft-delete-only product decision, Oct 29). Clients still
            # delete their local copy on pull; restore brings the row back.
            cur = _get(conn, ctx.user_id, col, eid, include_deleted=True)
            _apply(conn, ctx.user_id, col, eid, True, cur["data"] if cur else {})
            if cascade_root is not None:
                conn.execute(
                    "UPDATE entities SET deleted_with = ? WHERE user_id = ? AND collection = ? AND id = ?",
                    (cascade_root, ctx.user_id, col, eid),
                )

        if collection == "tasks":
            # Subtasks go too, at every depth (deeper than the app's own
            # direct-child delete: the server is the convergence point, and
            # restoring the root brings the whole subtree back). Dead
            # blockedBy refs are stripped. A project-scoped key may only run
            # the delete when every row it would touch is inside its subtree;
            # otherwise the whole delete is refused.
            tasks = _all(conn, ctx.user_id, "tasks")
            by_id = {t["id"]: t for t in tasks}
            descendants: list[str] = []
            seen = {entity_id}
            frontier = [entity_id]
            while frontier:
                cur = frontier.pop()
                for t in tasks:
                    if t.get("parentId") == cur and t["id"] not in seen:
                        seen.add(t["id"])
                        descendants.append(t["id"])
                        frontier.append(t["id"])
            gone = {entity_id, *descendants}
            deleted_ids = [entity_id, *descendants]
            if ctx.project_id is not None:
                tree = _project_subtree(conn, ctx.user_id, ctx.project_id)
                touched = [tid for tid in descendants if (by_id.get(tid) or {}).get("projectId") not in tree]
                touched += [t["id"] for t in tasks
                            if t["id"] not in gone and t.get("projectId") not in tree
                            and any(b in gone for b in (t.get("blockedBy") or []))]
                if touched:
                    raise HTTPException(status_code=409,
                                        detail="this delete would cascade outside the key's project scope")
            tombstone("tasks", entity_id)
            for tid in descendants:
                tombstone("tasks", tid, cascade_root=entity_id)
            for a in _all(conn, ctx.user_id, "attachments"):
                if a.get("taskId") in gone:
                    tombstone("attachments", a["id"], cascade_root=entity_id)
                    deleted_ids.append(a["id"])
            for t in tasks:
                refs = [b for b in (t.get("blockedBy") or []) if b in gone]
                if refs and t["id"] not in gone:
                    updated = {**t, "blockedBy": [b for b in t["blockedBy"] if b not in gone],
                               "updatedAt": now}
                    _apply(conn, ctx.user_id, "tasks", t["id"], False, updated)
        elif collection == "projects":
            # Mirror deleteProject: this project's own tasks (and their subtasks) go;
            # subprojects move up one level and stay intact (product decision, Oct 27).
            project = ent["data"] | {"id": entity_id}
            tasks = _all(conn, ctx.user_id, "tasks")
            own = [t for t in tasks if t.get("projectId") == entity_id]
            gone_tasks = {t["id"] for t in own}
            frontier = list(gone_tasks)
            while frontier:
                cur = frontier.pop()
                for t in tasks:
                    if t.get("parentId") == cur and t["id"] not in gone_tasks:
                        gone_tasks.add(t["id"])
                        frontier.append(t["id"])
            children = [t for t in tasks if t["id"] in gone_tasks and t.get("projectId") != entity_id]
            deleted_ids = [entity_id, *[t["id"] for t in own], *[t["id"] for t in children]]
            tombstone("projects", entity_id)
            for t in own + children:
                tombstone("tasks", t["id"], cascade_root=entity_id)
            for a in _all(conn, ctx.user_id, "attachments"):
                if a.get("taskId") in gone_tasks:
                    tombstone("attachments", a["id"], cascade_root=entity_id)
                    deleted_ids.append(a["id"])
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


@router.post("/agent/entities/{collection}/{entity_id}/restore", dependencies=WRITE)
def agent_restore(collection: str, entity_id: str, ctx: AgentCtx = Depends(agent_auth)):
    if collection not in AGENT_COLLECTIONS:
        raise HTTPException(status_code=404, detail="unknown collection")

    _scope_check_collection(ctx, collection)

    def fn(conn):
        ent = _get(conn, ctx.user_id, collection, entity_id, include_deleted=True)
        if ent is None:
            raise HTTPException(status_code=404, detail="not found")
        if not ent["deleted"]:
            raise HTTPException(status_code=409, detail="entity is not deleted")
        data = ent["data"]
        if not isinstance(data, dict) or not data:
            raise HTTPException(status_code=409,
                                detail="nothing recoverable: this tombstone has no preserved payload")

        def live(col, eid):
            return eid is None or _get(conn, ctx.user_id, col, eid) is not None

        # Containment integrity: never restore an orphan into a deleted
        # container. Soft references (goalId, noteId, blockedBy, ...) may
        # point at tombstones by design; containment may not.
        container = {"tasks": [("projects", data.get("projectId"), "project"),
                               ("tasks", data.get("parentId"), "parent task")],
                     "projects": [("projects", data.get("parentId"), "parent project")],
                     "focusSessions": [("tasks", data.get("taskId"), "task")],
                     "habitLogs": [("habits", data.get("habitId"), "habit")]}.get(collection, [])
        for col, eid, label in container:
            if not live(col, eid):
                raise HTTPException(status_code=409, detail=f"its {label} is deleted; restore that first")
        if collection == "journal":
            clash = [e for e in _all(conn, ctx.user_id, "journal")
                     if e.get("date") == data.get("date") and e["id"] != entity_id]
            if clash:
                raise HTTPException(status_code=409,
                                    detail=f"a live journal entry already exists for {data.get('date')}")
        if collection == "tasks":
            _scope_check_task(conn, ctx, data)
        _apply(conn, ctx.user_id, collection, entity_id, False, data)
        restored = [f"{collection}:{entity_id}"]
        skipped = 0  # count only: out-of-scope identifiers must not leak
        rows = conn.execute(
            "SELECT collection, id FROM entities WHERE user_id = ? AND deleted = 1 AND deleted_with = ?",
            (ctx.user_id, entity_id),
        ).fetchall()
        for r in rows:
            child = _get(conn, ctx.user_id, r["collection"], r["id"], include_deleted=True)
            if ctx.project_id is not None and r["collection"] == "tasks":
                try:
                    _scope_check_task(conn, ctx, child["data"])
                except HTTPException:
                    skipped += 1
                    continue
            _apply(conn, ctx.user_id, r["collection"], r["id"], False, child["data"])
            restored.append(f"{r['collection']}:{r['id']}")
        # Reference rewrites done during the delete (blockedBy stripping,
        # noteId drops, subproject reparenting) are NOT reversed by restore;
        # restore recovers the entities, not the exact prior graph.
        _audit(conn, ctx, "entity.restore", collection, entity_id,
               f"restored={len(restored)} skipped={skipped}")
        return {"restored": True, "ids": restored, "skippedOutOfScope": skipped}

    return _write(ctx, fn)
