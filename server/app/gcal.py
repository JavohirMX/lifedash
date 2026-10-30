"""Read-only Google Calendar display (CANDIDATE: off unless fully configured).

NOTHING here talks to Google unless the self-hoster sets every variable below
and a signed-in user clicks Connect. Tests use a fake Google.

Design (see docs in the module constants):
- The owner brings their OWN Google Cloud OAuth web client. No shared client.
- Scope: calendar.events.owned.readonly only. Per Google's scope table that is
  "see the events on Google calendars you own". It cannot list calendars and does
  not cover calendars shared with you, so v1 reads the owner's primary calendar only.
- Client secret and encryption keys come from the environment (or *_FILE), never
  from the database, the browser bundle or sync data.
- The refresh token is stored encrypted (Fernet, MultiFernet for key rotation).
  If no key is configured the feature stays off; there is no default key.
- Events are fetched on demand with timeMin/timeMax and are not stored. Google's
  incremental syncToken cannot be combined with timeMin/timeMax, so it is not used.
- Only title, time and an all-day flag are passed to the app. No description,
  attendees, links, or locations.
- Disconnect revokes the token at Google and deletes the stored copy.

Environment:
  SYNC_GOOGLE_ENABLED=1
  GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (or GOOGLE_CLIENT_SECRET_FILE)
  GOOGLE_REDIRECT_URI  https://... or http://localhost[:port]/... (anything else is refused)
  SYNC_SECRET_KEYS     comma-separated Fernet keys; first encrypts, all decrypt (rotation)
                       (or SYNC_SECRET_KEYS_FILE)
"""

import base64
import hashlib
import json
import os
import secrets
import logging
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse

from .auth import current_user
from .db import get_conn

SCOPE = "https://www.googleapis.com/auth/calendar.events.owned.readonly"
AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
STATE_TTL_S = 600
MAX_WINDOW_DAYS = 100
MAX_EVENTS = 500
MAX_PAGES = 10
REQUEST_BUDGET_S = 25.0  # whole /events request, refresh included; each call's timeout is capped to what is left
CALL_TIMEOUT_S = 15.0
MAX_PENDING_PER_USER = 5
MAX_PENDING_TOTAL = 1000
CALLBACK_LIMIT = 30  # requests per client address per window
CALLBACK_WINDOW_S = 60

router = APIRouter()

_cb_hits: dict[str, deque] = defaultdict(deque)


def _callback_rate_limit(client: str) -> None:
    """Sliding window per client address. Behind a proxy that address is the proxy's: coarse cap."""
    now = time.monotonic()
    q = _cb_hits[client]
    while q and now - q[0] > CALLBACK_WINDOW_S:
        q.popleft()
    if len(q) >= CALLBACK_LIMIT:
        raise HTTPException(status_code=429, detail="too many requests", headers={"Retry-After": str(CALLBACK_WINDOW_S)})
    q.append(now)
    if len(_cb_hits) > 10_000:
        for k in [k for k, v in _cb_hits.items() if not v or now - v[-1] > CALLBACK_WINDOW_S]:
            _cb_hits.pop(k, None)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS google_link (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  refresh_token_enc TEXT NOT NULL,
  connected_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS google_oauth_state (
  state_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verifier TEXT NOT NULL,
  expires_at REAL NOT NULL,
  gen INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS google_gen (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  gen INTEGER NOT NULL DEFAULT 0
);
"""


# ---------------------------------------------------------------- config

def _env_or_file(name: str) -> str | None:
    v = os.environ.get(name)
    if v:
        return v.strip()
    path = os.environ.get(name + "_FILE")
    if path:
        try:
            with open(path, encoding="utf-8") as f:
                return f.read().strip()
        except OSError:
            return None
    return None


def _redirect_ok(uri: str) -> bool:
    u = urllib.parse.urlparse(uri)
    if not u.netloc or u.fragment:
        return False
    if u.scheme == "https":
        return True
    return u.scheme == "http" and u.hostname in ("localhost", "127.0.0.1")


def _fernet():
    """MultiFernet over SYNC_SECRET_KEYS, or None when unset/invalid/not installed."""
    raw = _env_or_file("SYNC_SECRET_KEYS")
    if not raw:
        return None
    try:
        from cryptography.fernet import Fernet, MultiFernet

        return MultiFernet([Fernet(k.strip().encode()) for k in raw.split(",") if k.strip()])
    except Exception:  # missing package or malformed key: stay off, never fall back to plaintext
        return None


def config() -> dict | None:
    """The full configuration, or None if anything needed is missing or unsafe."""
    if os.environ.get("SYNC_GOOGLE_ENABLED") != "1":
        return None
    cid = _env_or_file("GOOGLE_CLIENT_ID")
    secret = _env_or_file("GOOGLE_CLIENT_SECRET")
    redirect = _env_or_file("GOOGLE_REDIRECT_URI")
    if not (cid and secret and redirect and _redirect_ok(redirect)) or _fernet() is None:
        return None
    return {"client_id": cid, "client_secret": secret, "redirect_uri": redirect}


def config_problem() -> str | None:
    """Why the feature is off, only when the owner asked for it (SYNC_GOOGLE_ENABLED=1); else None."""
    if os.environ.get("SYNC_GOOGLE_ENABLED") != "1":
        return None
    if not (_env_or_file("GOOGLE_CLIENT_ID") and _env_or_file("GOOGLE_CLIENT_SECRET")):
        return "missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET"
    r = _env_or_file("GOOGLE_REDIRECT_URI")
    if not (r and _redirect_ok(r)):
        return "GOOGLE_REDIRECT_URI missing or not https/localhost"
    try:
        import cryptography  # noqa: F401
    except ImportError:
        return "the cryptography package is not installed (see requirements-google.txt)"
    if _fernet() is None:
        return "SYNC_SECRET_KEYS missing or invalid"
    return None


def _need_config() -> dict:
    cfg = config()
    if cfg is None:
        raise HTTPException(status_code=404, detail="not found")
    return cfg


_schema_lock = threading.Lock()
_schema_done: set[str] = set()


def _conn():
    """Connection with the feature tables present. Schema is created once per database file."""
    conn = get_conn()
    from .db import DB_PATH

    if DB_PATH not in _schema_done:
        with _schema_lock:
            if DB_PATH not in _schema_done:
                for stmt in _SCHEMA.split(";"):
                    if stmt.strip():
                        conn.execute(stmt)
                conn.commit()
                _schema_done.add(DB_PATH)
    return conn


def _has_link_table() -> bool:
    return get_conn().execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='google_link'").fetchone() is not None


# ---------------------------------------------------------------- Google transport (replaced in tests)

MAX_RESPONSE_BYTES = 2_000_000


def _read_json(r) -> dict:
    raw = r.read(MAX_RESPONSE_BYTES + 1)
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ValueError("response too large")
    data = json.loads(raw or b"{}")
    if not isinstance(data, dict):
        raise ValueError("unexpected JSON shape")
    return data


def _post_form(url: str, data: dict, timeout: float = 15) -> tuple[int, dict]:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 (fixed https URLs above)
            return r.status, _read_json(r)
    except urllib.error.HTTPError as e:
        try:
            return e.code, _read_json(e)
        except (ValueError, OSError):
            return e.code, {}
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return 599, {}


def _get_json(url: str, bearer: str, timeout: float = 15) -> tuple[int, dict]:
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {bearer}"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310
            return r.status, _read_json(r)
    except urllib.error.HTTPError as e:
        return e.code, {}
    except (urllib.error.URLError, TimeoutError, ValueError, OSError):
        return 599, {}


_CALLBACK_QUERY = re.compile(r"(/api/google/callback)\?[^\s\"]*")


class _RedactCallbackQuery(logging.Filter):
    """The callback URL carries the one-time code and state in its query string."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple):
            record.args = tuple(_CALLBACK_QUERY.sub(r"\1?[redacted]", a) if isinstance(a, str) else a for a in record.args)
        if isinstance(record.msg, str):
            record.msg = _CALLBACK_QUERY.sub(r"\1?[redacted]", record.msg)
        return True


logging.getLogger("uvicorn.access").addFilter(_RedactCallbackQuery())

# ---------------------------------------------------------------- helpers

def _h(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def _pkce() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    return verifier, challenge


def normalize_event(e) -> dict | None:
    """Reduce a Google event to what the app displays. Returns None for cancelled or malformed items."""
    if not isinstance(e, dict) or e.get("status") == "cancelled":
        return None
    start, end = e.get("start"), e.get("end")
    if not isinstance(start, dict) or not isinstance(end, dict):
        return None
    all_day = "date" in start
    s = start.get("date") or start.get("dateTime")
    en = end.get("date") or end.get("dateTime")
    if not isinstance(s, str) or not isinstance(en, str) or not isinstance(e.get("id"), str):
        return None
    summary = e.get("summary")
    return {
        "id": e["id"][:256],
        "title": (summary if isinstance(summary, str) and summary else "(no title)")[:300],
        "start": s[:40],
        "end": en[:40],
        "allDay": all_day,
    }


# ---------------------------------------------------------------- routes

@router.get("/api/google/status")
def status(user_id: int = Depends(current_user)):
    """Works even when the feature is switched off, so a stored link can always be seen and removed."""
    linked = None
    if _has_link_table():
        row = get_conn().execute("SELECT connected_at FROM google_link WHERE user_id = ?", (user_id,)).fetchone()
        linked = row["connected_at"] if row else None
    problem = config_problem()
    if config() is None:
        out = {"available": False, "connected": linked is not None, "connected_at": linked}
        if problem:
            out["problem"] = problem
        return out
    return {"available": True, "connected": linked is not None, "connected_at": linked, "scope": SCOPE}


@router.post("/api/google/connect")
def connect(user_id: int = Depends(current_user)):
    cfg = _need_config()
    state = secrets.token_urlsafe(32)
    verifier, challenge = _pkce()
    conn = _conn()
    conn.execute("DELETE FROM google_oauth_state WHERE expires_at < ?", (time.time(),))
    if conn.execute("SELECT COUNT(*) FROM google_oauth_state").fetchone()[0] >= MAX_PENDING_TOTAL:
        conn.commit()  # never leave a write transaction open on this thread's connection
        raise HTTPException(status_code=429, detail="too many pending connections; try again in a few minutes")
    # keep only the newest MAX_PENDING_PER_USER-1 older attempts for this user, so a click loop cannot grow the table
    conn.execute(
        "DELETE FROM google_oauth_state WHERE user_id = ? AND state_hash NOT IN "
        "(SELECT state_hash FROM google_oauth_state WHERE user_id = ? ORDER BY expires_at DESC LIMIT ?)",
        (user_id, user_id, MAX_PENDING_PER_USER - 1),
    )
    conn.execute(
        "INSERT INTO google_oauth_state (state_hash, user_id, verifier, expires_at, gen) "
        "VALUES (?, ?, ?, ?, COALESCE((SELECT gen FROM google_gen WHERE user_id = ?), 0))",
        (_h(state), user_id, verifier, time.time() + STATE_TTL_S, user_id),
    )
    conn.commit()
    q = urllib.parse.urlencode({
        "client_id": cfg["client_id"], "redirect_uri": cfg["redirect_uri"], "response_type": "code",
        "scope": SCOPE, "access_type": "offline", "prompt": "consent", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256",
    })
    return {"url": f"{AUTH_URL}?{q}"}


@router.get("/api/google/callback", response_class=HTMLResponse)
def callback(request: Request, code: str = Query(default="", max_length=2048), state: str = Query(default="", max_length=256), error: str = Query(default="", max_length=256)):
    cfg = _need_config()
    _callback_rate_limit(request.client.host if request.client else "unknown")
    page = lambda msg: HTMLResponse(f"<!doctype html><meta charset=utf-8><title>LifeDash</title><p>{msg}</p>", headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})  # noqa: E731
    conn = _conn()
    # Atomic single use: the DELETE ... RETURNING claims the state; a concurrent or replayed
    # request with the same state gets no row, whatever happens next.
    row = None
    if state:
        row = conn.execute(
            "DELETE FROM google_oauth_state WHERE state_hash = ? RETURNING user_id, verifier, expires_at, gen", (_h(state),)
        ).fetchone()
        conn.commit()
    if row is None or row["expires_at"] < time.time():
        return page("This link expired or was already used. Start again from LifeDash.")
    if error or not code:
        return page("Google did not grant access. Nothing was saved.")
    st, tok = _post_form(TOKEN_URL, {
        "code": code, "client_id": cfg["client_id"], "client_secret": cfg["client_secret"],
        "redirect_uri": cfg["redirect_uri"], "grant_type": "authorization_code", "code_verifier": row["verifier"],
    })
    refresh = tok.get("refresh_token") if st == 200 else None
    if not refresh or SCOPE not in str(tok.get("scope", "")).split():
        return page("Google did not return the expected read-only access. Nothing was saved.")
    enc = _fernet().encrypt(refresh.encode()).decode()
    # Save only if the user has not disconnected since this sign-in started. One statement, so the
    # generation check and the write are atomic, and no transaction is held across the network call.
    cur = conn.execute(
        "INSERT INTO google_link (user_id, refresh_token_enc) "
        "SELECT ?, ? WHERE COALESCE((SELECT gen FROM google_gen WHERE user_id = ?), 0) = ? "
        "ON CONFLICT(user_id) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc, connected_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')",
        (row["user_id"], enc, row["user_id"], row["gen"]),
    )
    conn.commit()
    if cur.rowcount == 0:
        _post_form(REVOKE_URL, {"token": refresh})  # best effort: do not keep a grant the user cancelled
        return page("This sign-in was cancelled by Disconnect. Nothing was saved.")
    return page("Connected read-only. You can close this tab.")


@router.post("/api/google/disconnect")
def disconnect(user_id: int = Depends(current_user)):
    """Always possible, even when the feature is off or the key is gone.

    Removes our encrypted copy and cancels this user's pending sign-ins. Revocation at Google is
    tried only when the key and client settings allow it. `revoked` is true only when Google
    answered 200; otherwise the user should remove LifeDash at https://myaccount.google.com/permissions.
    """
    if not _has_link_table():
        return {"removed": False, "revoked": False}
    conn = _conn()
    row = conn.execute("SELECT refresh_token_enc FROM google_link WHERE user_id = ?", (user_id,)).fetchone()
    revoked = False
    if row is not None:
        f = _fernet()
        if f is not None:
            try:
                st, _ = _post_form(REVOKE_URL, {"token": f.decrypt(row["refresh_token_enc"].encode()).decode()})
                revoked = st == 200
            except Exception:  # undecryptable token: nothing to send to Google
                revoked = False
    conn.execute("DELETE FROM google_oauth_state WHERE user_id = ?", (user_id,))
    conn.execute("DELETE FROM google_link WHERE user_id = ?", (user_id,))
    # cancel sign-ins that already claimed their state and are waiting on Google
    conn.execute("INSERT INTO google_gen (user_id, gen) VALUES (?, 1) ON CONFLICT(user_id) DO UPDATE SET gen = gen + 1", (user_id,))
    conn.commit()
    return {"removed": row is not None, "revoked": revoked}


@router.get("/api/google/events")
def events(start: str = Query(min_length=10, max_length=10), end: str = Query(min_length=10, max_length=10), user_id: int = Depends(current_user)):
    cfg = _need_config()
    try:
        d0 = datetime.strptime(start, "%Y-%m-%d").replace(tzinfo=timezone.utc)
        d1 = datetime.strptime(end, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        raise HTTPException(status_code=422, detail="dates must be YYYY-MM-DD")
    if d1 <= d0 or d1 - d0 > timedelta(days=MAX_WINDOW_DAYS):
        raise HTTPException(status_code=422, detail=f"window must be 1 to {MAX_WINDOW_DAYS} days")
    conn = _conn()
    row = conn.execute("SELECT refresh_token_enc FROM google_link WHERE user_id = ?", (user_id,)).fetchone()
    if row is None:
        raise HTTPException(status_code=409, detail="not connected")
    f = _fernet()
    try:
        refresh = f.decrypt(row["refresh_token_enc"].encode()).decode()
    except Exception:
        raise HTTPException(status_code=409, detail="stored token cannot be decrypted; reconnect")
    # Opportunistic re-wrap: a token read with an older key is rewritten with the first key.
    try:
        conn.execute("UPDATE google_link SET refresh_token_enc = ? WHERE user_id = ?", (f.rotate(row["refresh_token_enc"].encode()).decode(), user_id))
        conn.commit()
    except Exception:
        pass
    deadline = time.monotonic() + REQUEST_BUDGET_S
    st, tok = _post_form(TOKEN_URL, {"client_id": cfg["client_id"], "client_secret": cfg["client_secret"], "refresh_token": refresh, "grant_type": "refresh_token"}, timeout=min(CALL_TIMEOUT_S, REQUEST_BUDGET_S))
    if st in (400, 401) and tok.get("error") == "invalid_grant":  # revoked or expired (e.g. Testing-mode 7 days)
        conn.execute("DELETE FROM google_link WHERE user_id = ?", (user_id,))
        conn.commit()
        raise HTTPException(status_code=409, detail="Google access expired or was revoked; reconnect")
    access = tok.get("access_token")
    if st != 200 or not isinstance(access, str) or not access:
        raise HTTPException(status_code=502, detail="Google token request failed")
    out: list[dict] = []
    reason = None
    seen_tokens: set[str] = set()
    page_token = None
    for _page in range(MAX_PAGES):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            reason = "time_budget"
            break
        params = {"singleEvents": "true", "orderBy": "startTime", "maxResults": "250",
                  "timeMin": d0.strftime("%Y-%m-%dT%H:%M:%SZ"), "timeMax": d1.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "fields": "nextPageToken,items(id,status,summary,start,end)"}
        if page_token:
            params["pageToken"] = page_token
        st, body = _get_json(f"{EVENTS_URL}?{urllib.parse.urlencode(params)}", access, timeout=min(CALL_TIMEOUT_S, remaining))
        if st != 200:
            raise HTTPException(status_code=502, detail="Google events request failed")
        items = body.get("items")
        for item in items if isinstance(items, list) else []:
            n = normalize_event(item)
            if n:
                out.append(n)
        nxt = body.get("nextPageToken")
        if not isinstance(nxt, str) or not nxt:
            page_token = None
            break
        if nxt in seen_tokens or nxt == page_token:
            reason = "repeated_page_token"
            page_token = nxt
            break
        seen_tokens.add(nxt)
        page_token = nxt
        if len(out) >= MAX_EVENTS:
            reason = "event_cap"
            break
    else:
        reason = "page_cap"
    if len(out) > MAX_EVENTS:
        reason = "event_cap"
    # `truncated` is true whenever the list may be incomplete, and `reason` says why.
    return {"events": out[:MAX_EVENTS], "truncated": reason is not None, "reason": reason}


def rotate_tokens() -> dict:
    """Re-encrypt every stored refresh token with the FIRST key in SYNC_SECRET_KEYS.

    Run after prepending a new key. Rows that no key can decrypt are left untouched and counted
    (the user must reconnect). Safe to run repeatedly.
    """
    f = _fernet()
    if f is None:
        raise RuntimeError("SYNC_SECRET_KEYS is missing or invalid")
    conn = _conn()
    done = failed = 0
    for row in conn.execute("SELECT user_id, refresh_token_enc FROM google_link").fetchall():
        try:
            new = f.rotate(row["refresh_token_enc"].encode()).decode()
        except Exception:
            failed += 1
            continue
        conn.execute("UPDATE google_link SET refresh_token_enc = ? WHERE user_id = ?", (new, row["user_id"]))
        done += 1
    conn.commit()
    return {"rotated": done, "unreadable": failed}


def unrotated_count() -> int:
    """Stored tokens that the FIRST key alone cannot read. Must be 0 before retiring an older key.

    Fails closed: if tokens exist and the key setting is missing or invalid this raises, it never
    reports 0. Returns 0 only when nothing is stored (no table, or no rows).
    """
    if not _has_link_table():
        return 0
    rows = get_conn().execute("SELECT refresh_token_enc FROM google_link").fetchall()
    if not rows:
        return 0
    raw = _env_or_file("SYNC_SECRET_KEYS")
    if not raw:
        raise RuntimeError("SYNC_SECRET_KEYS is missing: cannot check stored tokens")
    from cryptography.fernet import Fernet, InvalidToken

    try:
        first = Fernet(raw.split(",")[0].strip().encode())
    except Exception:
        raise RuntimeError("the first key in SYNC_SECRET_KEYS is invalid")
    n = 0
    for row in rows:
        try:
            first.decrypt(row["refresh_token_enc"].encode())
        except InvalidToken:
            n += 1
    return n
