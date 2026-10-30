import time
import urllib.parse
import uuid

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app import gcal
from app.db import get_conn
from app.main import app

KEY1, KEY2 = Fernet.generate_key().decode(), Fernet.generate_key().decode()
SCOPE = gcal.SCOPE


@pytest.fixture(autouse=True)
def clean_state():
    from app.db import init_db

    init_db()
    gcal._cb_hits.clear()
    c = gcal._conn()
    c.execute("DELETE FROM google_link")
    c.execute("DELETE FROM google_oauth_state")
    c.commit()
    yield
    gcal._cb_hits.clear()


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


@pytest.fixture()
def on(monkeypatch):
    monkeypatch.setenv("SYNC_GOOGLE_ENABLED", "1")
    monkeypatch.setenv("GOOGLE_CLIENT_ID", "cid.apps.example")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET", "CLIENTSECRET-xyz")
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "http://localhost:8000/api/google/callback")
    monkeypatch.setenv("SYNC_SECRET_KEYS", KEY1)


class FakeGoogle:
    def __init__(self):
        self.posts, self.gets = [], []
        self.token_resp = (200, {"access_token": "AT", "refresh_token": "RT-secret", "scope": SCOPE})
        self.refresh_resp = (200, {"access_token": "AT2"})
        self.events_pages = [(200, {"items": []})]

    def post(self, url, data, timeout=15):
        self.timeouts = getattr(self, 'timeouts', []) + [timeout]
        self.posts.append((url, dict(data)))
        if url == gcal.TOKEN_URL:
            return self.token_resp if data.get("grant_type") == "authorization_code" else self.refresh_resp
        return 200, {}

    def get(self, url, bearer, timeout=15):
        self.timeouts = getattr(self, 'timeouts', []) + [timeout]
        self.gets.append((url, bearer))
        return self.events_pages.pop(0)


@pytest.fixture()
def g(monkeypatch):
    f = FakeGoogle()
    monkeypatch.setattr(gcal, "_post_form", f.post)
    monkeypatch.setattr(gcal, "_get_json", f.get)
    return f


def login(client):
    r = client.post("/api/register", json={"username": f"u-{uuid.uuid4().hex[:8]}", "password": "correct horse battery"})
    return {"Authorization": f"Bearer {r.json()['token']}"}


def start(client, h):
    url = client.post("/api/google/connect", headers=h).json()["url"]
    return urllib.parse.parse_qs(urllib.parse.urlparse(url).query), url


def connected(client, g):
    h = login(client)
    q, _ = start(client, h)
    r = client.get("/api/google/callback", params={"code": "abc", "state": q["state"][0]})
    assert "Connected" in r.text
    return h


# ---- off by default

@pytest.mark.parametrize("drop", ["SYNC_GOOGLE_ENABLED", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI", "SYNC_SECRET_KEYS"])
def test_off_when_any_setting_missing(client, on, monkeypatch, drop):
    monkeypatch.delenv(drop)
    h = login(client)
    assert gcal.config() is None
    st = client.get("/api/google/status", headers=h).json()
    assert st["available"] is False and st["connected"] is False
    assert ("problem" in st) == (drop != "SYNC_GOOGLE_ENABLED")  # a reason only when the owner asked for it
    assert client.post("/api/google/connect", headers=h).status_code == 404
    assert client.get("/api/google/callback", params={"code": "c", "state": "s"}).status_code == 404
    assert client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-08"}).status_code == 404
    assert client.post("/api/google/disconnect", headers=h).json() == {"removed": False, "revoked": False}  # nothing stored, nothing to do


@pytest.mark.parametrize("uri", ["http://example.com/cb", "ftp://x/cb", "/relative", "https://x/cb#frag", "javascript:alert(1)"])
def test_unsafe_redirect_uri_keeps_it_off(client, on, monkeypatch, uri):
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", uri)
    assert gcal.config() is None


def test_bad_encryption_key_keeps_it_off_never_plaintext(client, on, monkeypatch):
    monkeypatch.setenv("SYNC_SECRET_KEYS", "not-a-fernet-key")
    assert gcal.config() is None


def test_secrets_can_come_from_files(client, on, monkeypatch, tmp_path):
    monkeypatch.delenv("GOOGLE_CLIENT_SECRET")
    monkeypatch.delenv("SYNC_SECRET_KEYS")
    (tmp_path / "s").write_text("FILESECRET\n")
    (tmp_path / "k").write_text(KEY1 + "\n")
    monkeypatch.setenv("GOOGLE_CLIENT_SECRET_FILE", str(tmp_path / "s"))
    monkeypatch.setenv("SYNC_SECRET_KEYS_FILE", str(tmp_path / "k"))
    assert gcal.config()["client_secret"] == "FILESECRET"


def test_login_required(client, on):
    for method, path in [("get", "/api/google/status"), ("post", "/api/google/connect"), ("post", "/api/google/disconnect"), ("get", "/api/google/events?start=2026-11-01&end=2026-11-02")]:
        assert getattr(client, method)(path).status_code == 401


# ---- connect / callback

def test_authorization_url_is_read_only_pkce_and_has_no_secret(client, on, g):
    q, url = start(client, login(client))
    assert q["scope"] == [SCOPE] and SCOPE.endswith("owned.readonly")
    assert q["access_type"] == ["offline"] and q["response_type"] == ["code"]
    assert q["code_challenge_method"] == ["S256"] and len(q["code_challenge"][0]) == 43
    assert len(q["state"][0]) >= 40
    assert "CLIENTSECRET" not in url and url.startswith(gcal.AUTH_URL + "?")
    assert g.posts == [] and g.gets == []  # connect itself calls nobody


def test_callback_stores_token_encrypted_and_sends_verifier(client, on, g):
    h = login(client)
    q, _ = start(client, h)
    r = client.get("/api/google/callback", params={"code": "abc", "state": q["state"][0]})
    assert "Connected read-only" in r.text and "RT-secret" not in r.text and "AT" not in r.text.replace("LifeDash", "")
    url, data = g.posts[0]
    assert url == gcal.TOKEN_URL and data["grant_type"] == "authorization_code" and data["code"] == "abc"
    assert data["code_verifier"] and data["redirect_uri"].startswith("http://localhost")
    stored = get_conn().execute("SELECT refresh_token_enc FROM google_link").fetchall()[-1]["refresh_token_enc"]
    assert "RT-secret" not in stored
    assert Fernet(KEY1.encode()).decrypt(stored.encode()).decode() == "RT-secret"
    st = client.get("/api/google/status", headers=h).json()
    assert st["available"] and st["connected"] and st["scope"] == SCOPE and "RT-secret" not in str(st)


def test_state_is_single_use_and_unknown_state_rejected(client, on, g):
    h = login(client)
    q, _ = start(client, h)
    s = q["state"][0]
    assert "Connected" in client.get("/api/google/callback", params={"code": "a", "state": s}).text
    assert "expired or was already used" in client.get("/api/google/callback", params={"code": "a", "state": s}).text
    assert "expired or was already used" in client.get("/api/google/callback", params={"code": "a", "state": "forged"}).text
    assert "expired or was already used" in client.get("/api/google/callback", params={"code": "a"}).text
    assert len([p for p in g.posts if p[1].get("grant_type") == "authorization_code"]) == 1


def test_expired_state_rejected(client, on, g):
    h = login(client)
    q, _ = start(client, h)
    get_conn().execute("UPDATE google_oauth_state SET expires_at = ?", (time.time() - 1,))
    get_conn().commit()
    assert "expired" in client.get("/api/google/callback", params={"code": "a", "state": q["state"][0]}).text
    assert g.posts == []


def test_denied_or_wrong_scope_saves_nothing(client, on, g):
    h = login(client)
    q, _ = start(client, h)
    assert "did not grant" in client.get("/api/google/callback", params={"error": "access_denied", "state": q["state"][0]}).text
    q, _ = start(client, h)
    g.token_resp = (200, {"access_token": "AT", "refresh_token": "RT", "scope": "https://www.googleapis.com/auth/calendar"})
    assert "Nothing was saved" in client.get("/api/google/callback", params={"code": "a", "state": q["state"][0]}).text
    q, _ = start(client, h)
    g.token_resp = (200, {"access_token": "AT", "scope": SCOPE})  # no refresh token
    assert "Nothing was saved" in client.get("/api/google/callback", params={"code": "a", "state": q["state"][0]}).text
    q, _ = start(client, h)
    g.token_resp = (400, {"error": "invalid_grant"})
    assert "Nothing was saved" in client.get("/api/google/callback", params={"code": "a", "state": q["state"][0]}).text
    assert client.get("/api/google/status", headers=h).json()["connected"] is False


def test_state_binds_to_the_user_who_started_it(client, on, g):
    a, b = login(client), login(client)
    qa, _ = start(client, a)
    client.get("/api/google/callback", params={"code": "a", "state": qa["state"][0]})
    assert client.get("/api/google/status", headers=a).json()["connected"] is True
    assert client.get("/api/google/status", headers=b).json()["connected"] is False
    assert client.get("/api/google/events", headers=b, params={"start": "2026-11-01", "end": "2026-11-02"}).status_code == 409


# ---- events

def test_events_normalized_minimal_and_requests_are_read_only_windowed(client, on, g):
    h = connected(client, g)
    g.events_pages = [(200, {"items": [
        {"id": "e1", "status": "confirmed", "summary": "Dentist", "start": {"dateTime": "2026-11-03T09:00:00+08:00"}, "end": {"dateTime": "2026-11-03T10:00:00+08:00"},
         "description": "PRIVATE", "attendees": [{"email": "x@y"}], "location": "Somewhere", "hangoutLink": "https://meet"},
        {"id": "e2", "summary": "Holiday", "start": {"date": "2026-11-04"}, "end": {"date": "2026-11-05"}},
        {"id": "e3", "status": "cancelled", "summary": "Gone", "start": {"date": "2026-11-04"}, "end": {"date": "2026-11-05"}},
        {"id": "e4", "start": {}, "end": {}},
    ]})]
    r = client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-08"})
    assert r.status_code == 200
    ev = r.json()["events"]
    assert [e["id"] for e in ev] == ["e1", "e2"]
    assert ev[1] == {"id": "e2", "title": "Holiday", "start": "2026-11-04", "end": "2026-11-05", "allDay": True}
    assert set(ev[0]) == {"id", "title", "start", "end", "allDay"}
    assert "PRIVATE" not in r.text and "meet" not in r.text and "Somewhere" not in r.text
    url, bearer = g.gets[0]
    q = urllib.parse.parse_qs(urllib.parse.urlparse(url).query)
    assert bearer == "AT2" and "/calendars/primary/events?" in url
    assert q["singleEvents"] == ["true"] and q["timeMin"] == ["2026-11-01T00:00:00Z"] and q["timeMax"] == ["2026-11-08T00:00:00Z"]
    assert "syncToken" not in q  # incompatible with timeMin/timeMax per Google's events.list docs
    assert "description" not in q["fields"][0]
    assert all(p[1].get("grant_type") != "authorization_code" for p in g.posts[1:])


def test_window_validation(client, on, g):
    h = connected(client, g)
    bad = [("2026-11-08", "2026-11-01"), ("2026-11-01", "2026-11-01"), ("2026-11-01", "2027-03-01"), ("nope-nope-", "2026-11-01"), ("2026-13-01", "2026-13-05")]
    for s, e in bad:
        assert client.get("/api/google/events", headers=h, params={"start": s, "end": e}).status_code == 422, (s, e)
    assert g.gets == []


def test_pagination_and_cap(client, on, g):
    h = connected(client, g)
    mk = lambda n, p: [{"id": f"{p}{i}", "summary": "x", "start": {"date": "2026-11-02"}, "end": {"date": "2026-11-03"}} for i in range(n)]  # noqa: E731
    g.events_pages = [(200, {"items": mk(250, "a"), "nextPageToken": "T1"}), (200, {"items": mk(250, "b"), "nextPageToken": "T2"})]
    r = client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-08"}).json()
    assert len(r["events"]) == 500 and r["truncated"] is True
    assert "pageToken=T1" in g.gets[1][0]


def test_expired_or_revoked_google_grant_removes_link_and_asks_to_reconnect(client, on, g):
    h = connected(client, g)
    g.refresh_resp = (400, {"error": "invalid_grant"})
    r = client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-08"})
    assert r.status_code == 409 and "reconnect" in r.json()["detail"]
    assert client.get("/api/google/status", headers=h).json()["connected"] is False


def test_google_errors_become_502_without_leaking(client, on, g):
    h = connected(client, g)
    g.refresh_resp = (599, {})
    assert client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-08"}).status_code == 502
    g.refresh_resp = (200, {"access_token": "AT2"})
    g.events_pages = [(403, {})]
    r = client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-08"})
    assert r.status_code == 502 and "AT2" not in r.text


# ---- key lifecycle, disconnect

def test_old_key_still_decrypts_and_a_key_that_never_saw_the_token_asks_reconnect(client, on, g, monkeypatch):
    h = connected(client, g)
    monkeypatch.setenv("SYNC_SECRET_KEYS", f"{KEY2},{KEY1}")  # new key first, old kept
    g.events_pages = [(200, {"items": []})]
    assert client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-08"}).status_code == 200
    h2 = connected(client, g)  # a second token, encrypted with KEY2 now
    monkeypatch.setenv("SYNC_SECRET_KEYS", KEY1)  # wrong key only: unreadable
    r = client.get("/api/google/events", headers=h2, params={"start": "2026-11-01", "end": "2026-11-08"})
    assert r.status_code == 409 and "reconnect" in r.json()["detail"]


def test_disconnect_revokes_at_google_and_deletes_local_copy(client, on, g):
    h = connected(client, g)
    assert client.post("/api/google/disconnect", headers=h).json() == {"removed": True, "revoked": True}
    revokes = [p for p in g.posts if p[0] == gcal.REVOKE_URL]
    assert revokes and revokes[0][1] == {"token": "RT-secret"}
    assert client.get("/api/google/status", headers=h).json()["connected"] is False
    assert client.post("/api/google/disconnect", headers=h).json() == {"removed": False, "revoked": False}  # idempotent


def test_normalize_handles_junk():
    assert gcal.normalize_event({}) is None
    assert gcal.normalize_event({"id": 5, "start": {"date": "x"}, "end": {"date": "y"}}) is None
    assert gcal.normalize_event({"id": "a", "start": {"date": "2026-01-01"}, "end": {"date": "2026-01-02"}, "summary": "t" * 999})["title"] == "t" * 300


def test_disconnect_reports_when_google_did_not_confirm_revocation(client, on, g, monkeypatch):
    h = connected(client, g)
    monkeypatch.setattr(gcal, "_post_form", lambda url, data, **k: (599, {}))
    assert client.post("/api/google/disconnect", headers=h).json() == {"removed": True, "revoked": False}
    assert client.get("/api/google/status", headers=h).json()["connected"] is False  # our copy is gone regardless


def test_disconnect_with_unreadable_token_still_removes_it(client, on, g, monkeypatch):
    h = connected(client, g)
    monkeypatch.setenv("SYNC_SECRET_KEYS", KEY2)
    n = len(g.posts)
    assert client.post("/api/google/disconnect", headers=h).json() == {"removed": True, "revoked": False}
    assert len(g.posts) == n  # nothing was sent to Google


def test_transient_refresh_failure_keeps_the_connection(client, on, g):
    h = connected(client, g)
    for resp in [(500, {}), (503, {"error": "backendError"}), (599, {}), (200, {})]:
        g.refresh_resp = resp
        r = client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-08"})
        assert r.status_code == 502, resp
        assert client.get("/api/google/status", headers=h).json()["connected"] is True


def test_concurrent_callbacks_with_same_state_exchange_once(client, on, g):
    import threading

    h = login(client)
    q, _ = start(client, h)
    results = []

    def hit():
        with TestClient(app) as c:
            results.append(c.get("/api/google/callback", params={"code": "a", "state": q["state"][0]}).text)

    ts = [threading.Thread(target=hit) for _ in range(8)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    assert sum("Connected read-only" in r for r in results) == 1
    assert len([p for p in g.posts if p[1].get("grant_type") == "authorization_code"]) == 1


def test_callback_failure_paths_still_consume_state(client, on, g):
    h = login(client)
    q, _ = start(client, h)
    g.token_resp = (500, {})
    assert "Nothing was saved" in client.get("/api/google/callback", params={"code": "a", "state": q["state"][0]}).text
    g.token_resp = (200, {"access_token": "AT", "refresh_token": "RT", "scope": SCOPE})
    assert "expired or was already used" in client.get("/api/google/callback", params={"code": "a", "state": q["state"][0]}).text
    assert client.get("/api/google/status", headers=h).json()["connected"] is False


def test_oversized_callback_params_rejected(client, on, g):
    r = client.get("/api/google/callback", params={"code": "x" * 3000, "state": "s"})
    assert r.status_code == 422
    assert client.get("/api/google/callback", params={"code": "c", "state": "s" * 300}).status_code == 422


def test_callback_rate_limited_per_client(client, on, g, monkeypatch):
    gcal._cb_hits.clear()
    monkeypatch.setattr(gcal, "CALLBACK_LIMIT", 3)
    codes = [client.get("/api/google/callback", params={"code": "c", "state": f"s{i}"}).status_code for i in range(5)]
    assert codes == [200, 200, 200, 429, 429]
    assert g.posts == []  # forged states never reach Google
    gcal._cb_hits.clear()


def test_pending_states_are_bounded_per_user_and_in_total(client, on, g, monkeypatch):
    h = login(client)
    first, _ = start(client, h)
    for _ in range(12):
        start(client, h)
    n = get_conn().execute("SELECT COUNT(*) FROM google_oauth_state WHERE user_id = (SELECT MAX(user_id) FROM google_oauth_state)").fetchone()[0]
    assert n <= gcal.MAX_PENDING_PER_USER
    assert "expired or was already used" in client.get("/api/google/callback", params={"code": "a", "state": first["state"][0]}).text
    monkeypatch.setattr(gcal, "MAX_PENDING_TOTAL", 0)
    assert client.post("/api/google/connect", headers=h).status_code == 429


def test_truncation_is_honest_at_the_500_boundary(client, on, g):
    h = connected(client, g)
    mk = lambda n, p: [{"id": f"{p}{i}", "summary": "x", "start": {"date": "2026-11-02"}, "end": {"date": "2026-11-03"}} for i in range(n)]  # noqa: E731
    win = {"start": "2026-11-01", "end": "2026-11-08"}
    g.events_pages = [(200, {"items": mk(250, "a"), "nextPageToken": "T"}), (200, {"items": mk(250, "b")})]
    r = client.get("/api/google/events", headers=h, params=win).json()
    assert len(r["events"]) == 500 and r["truncated"] is False  # exactly 500 and Google has no more
    g.events_pages = [(200, {"items": mk(250, "a"), "nextPageToken": "T"}), (200, {"items": mk(251, "b")})]
    r = client.get("/api/google/events", headers=h, params=win).json()
    assert len(r["events"]) == 500 and r["truncated"] is True  # one extra
    g.events_pages = [(200, {"items": mk(250, "a"), "nextPageToken": "T"}), (200, {"items": mk(250, "b"), "nextPageToken": "U"})]
    r = client.get("/api/google/events", headers=h, params=win).json()
    assert len(r["events"]) == 500 and r["truncated"] is True  # Google still has more pages


def test_rotate_tokens_reencrypts_with_first_key_and_counts_unreadable(client, on, g, monkeypatch):
    h = connected(client, g)
    monkeypatch.setenv("SYNC_SECRET_KEYS", f"{KEY2},{KEY1}")
    assert gcal.rotate_tokens() == {"rotated": 1, "unreadable": 0}
    monkeypatch.setenv("SYNC_SECRET_KEYS", KEY2)  # old key can now be dropped
    g.events_pages = [(200, {"items": []})]
    assert client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-08"}).status_code == 200
    monkeypatch.setenv("SYNC_SECRET_KEYS", KEY1)  # a key that never saw the new ciphertext
    before = get_conn().execute("SELECT refresh_token_enc FROM google_link").fetchall()
    assert gcal.rotate_tokens()["unreadable"] >= 1
    assert get_conn().execute("SELECT refresh_token_enc FROM google_link").fetchall() == before
    monkeypatch.delenv("SYNC_SECRET_KEYS")
    with pytest.raises(RuntimeError):
        gcal.rotate_tokens()


def test_admin_cli(client, on, capsys, monkeypatch):
    from app import gcal_admin

    assert gcal_admin.main(["x", "genkey"]) == 0
    k = capsys.readouterr().out.strip()
    Fernet(k.encode())  # a valid key
    assert gcal_admin.main(["x", "rotate"]) == 0
    monkeypatch.delenv("SYNC_SECRET_KEYS")
    assert gcal_admin.main(["x", "rotate"]) == 2
    assert gcal_admin.main(["x"]) == 2


# ---- v2: independent review findings, inverted into regression tests

def test_old_key_cannot_be_retired_unnoticed_events_rewrap_and_check_counts(client, on, g, monkeypatch):
    from app import gcal_admin

    h = connected(client, g)
    monkeypatch.setenv("SYNC_SECRET_KEYS", f"{KEY2},{KEY1}")
    assert gcal.unrotated_count() == 1 and gcal_admin.main(["x", "check"]) == 1
    # a normal use re-wraps the token with the first key ...
    assert client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"}).status_code == 200
    assert gcal.unrotated_count() == 0 and gcal_admin.main(["x", "check"]) == 0
    # ... so dropping the old key afterwards no longer breaks the link
    monkeypatch.setenv("SYNC_SECRET_KEYS", KEY2)
    g.events_pages = [(200, {"items": []})]
    assert client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"}).status_code == 200


def test_disconnect_works_while_feature_is_off_and_deletes_the_stored_copy(client, on, g, monkeypatch):
    h = connected(client, g)
    monkeypatch.delenv("SYNC_GOOGLE_ENABLED")
    assert client.get("/api/google/status", headers=h).json()["connected"] is True  # visible while off
    # the key is still readable, so revocation is attempted; the local copy goes either way
    assert client.post("/api/google/disconnect", headers=h).json() == {"removed": True, "revoked": True}
    assert g.posts[-1][0] == gcal.REVOKE_URL
    assert get_conn().execute("SELECT COUNT(*) FROM google_link").fetchone()[0] == 0


def test_disconnect_while_key_missing_still_deletes(client, on, g, monkeypatch):
    h = connected(client, g)
    monkeypatch.delenv("SYNC_SECRET_KEYS")
    assert client.post("/api/google/disconnect", headers=h).json() == {"removed": True, "revoked": False}
    assert get_conn().execute("SELECT COUNT(*) FROM google_link").fetchone()[0] == 0


def test_disconnect_cancels_pending_sign_in_so_a_late_callback_cannot_reconnect(client, on, g):
    h = connected(client, g)
    q, _ = start(client, h)
    client.post("/api/google/disconnect", headers=h)
    assert "expired or was already used" in client.get("/api/google/callback", params={"code": "late", "state": q["state"][0]}).text
    assert client.get("/api/google/status", headers=h).json()["connected"] is False


def test_repeated_page_token_stops_with_a_reason(client, on, g):
    h = connected(client, g)
    g.events_pages = [(200, {"items": [], "nextPageToken": "same"})] * 20
    r = client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"})
    assert r.status_code == 200 and r.json() == {"events": [], "truncated": True, "reason": "repeated_page_token"}
    assert len(g.gets) == 2  # first page, then the repeat is detected


def test_page_cap_stops_endless_distinct_tokens(client, on, g):
    h = connected(client, g)
    g.events_pages = [(200, {"items": [], "nextPageToken": f"t{i}"}) for i in range(50)]
    r = client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"}).json()
    assert r["truncated"] is True and r["reason"] == "page_cap" and len(g.gets) == gcal.MAX_PAGES


def test_time_budget_stops_slow_google(client, on, g, monkeypatch):
    h = connected(client, g)
    monkeypatch.setattr(gcal, "REQUEST_BUDGET_S", 0.0)
    r = client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"}).json()
    assert r["truncated"] is True and r["reason"] == "time_budget" and g.gets == []


def test_each_google_call_is_capped_to_the_remaining_request_budget(client, on, g, monkeypatch):
    h = connected(client, g)
    monkeypatch.setattr(gcal, "REQUEST_BUDGET_S", 3.0)
    g.timeouts = []
    g.events_pages = [(200, {"items": []})]
    client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"})
    assert len(g.timeouts) == 2 and all(0 < t <= 3.0 for t in g.timeouts)  # refresh + one events page


def test_complete_result_says_so(client, on, g):
    h = connected(client, g)
    g.events_pages = [(200, {"items": []})]
    assert client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"}).json() == {"events": [], "truncated": False, "reason": None}


def test_malformed_google_shapes_do_not_crash(client, on, g):
    h = connected(client, g)
    g.events_pages = [(200, {"items": ["str", 5, None, {"id": "a", "start": "x", "end": []}, {"id": "b", "start": {"date": 5}, "end": {"date": "y"}},
                                      {"id": "ok", "summary": 7, "start": {"date": "2026-11-02"}, "end": {"date": "2026-11-03"}}]})]
    r = client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"}).json()
    assert [e["id"] for e in r["events"]] == ["ok"] and r["events"][0]["title"] == "(no title)"
    g.events_pages = [(200, {"items": "notalist", "nextPageToken": 5})]
    assert client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"}).json()["events"] == []
    g.refresh_resp = (200, {"access_token": 5})
    assert client.get("/api/google/events", headers=h, params={"start": "2026-11-01", "end": "2026-11-02"}).status_code == 502


def test_transport_rejects_oversize_and_non_object_json(monkeypatch):
    import io

    class R(io.BytesIO):
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    for payload in [b"x" * (gcal.MAX_RESPONSE_BYTES + 5), b"[1,2]", b"not json"]:
        monkeypatch.setattr(gcal.urllib.request, "urlopen", lambda *a, **k: R(payload))
        assert gcal._post_form(gcal.TOKEN_URL, {}) == (599, {})
        assert gcal._get_json("https://x", "t") == (599, {})
    monkeypatch.setattr(gcal.urllib.request, "urlopen", lambda *a, **k: R(b'{"a": 1}'))
    assert gcal._post_form(gcal.TOKEN_URL, {}) == (200, {"a": 1})


def test_callback_query_is_redacted_from_access_log():
    import logging

    rec = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, '%s - "%s %s HTTP/%s" %d',
                            ("1.2.3.4:5", "GET", "/api/google/callback?code=4%2FSECRETCODE&state=SECRETSTATE", "1.1", 200), None)
    for f in logging.getLogger("uvicorn.access").filters:
        f.filter(rec)
    out = rec.getMessage()
    assert "SECRET" not in out and "/api/google/callback?[redacted]" in out


def test_status_names_the_problem_only_when_asked_for(client, on, monkeypatch):
    h = login(client)
    monkeypatch.setenv("SYNC_SECRET_KEYS", "bad")
    assert "SYNC_SECRET_KEYS" in client.get("/api/google/status", headers=h).json()["problem"]
    monkeypatch.setenv("GOOGLE_REDIRECT_URI", "http://evil.example/cb")
    assert "GOOGLE_REDIRECT_URI" in client.get("/api/google/status", headers=h).json()["problem"]
    monkeypatch.delenv("SYNC_GOOGLE_ENABLED")
    assert "problem" not in client.get("/api/google/status", headers=h).json()


def test_missing_cryptography_package_is_diagnosed_not_a_crash(client, on, monkeypatch):
    import builtins

    real = builtins.__import__

    def fake(name, *a, **k):
        if name.startswith("cryptography"):
            raise ImportError(name)
        return real(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", fake)
    assert gcal.config() is None
    assert "cryptography package is not installed" in gcal.config_problem()


# ---- v2 review repros, inverted

def test_inflight_callback_cannot_reconnect_after_disconnect(client, on, g, monkeypatch):
    import threading

    h = connected(client, g)
    q, _ = start(client, h)
    entered, release = threading.Event(), threading.Event()
    original = g.post

    def blocked(url, data, timeout=15):
        if data.get("grant_type") == "authorization_code":
            entered.set()
            assert release.wait(5)
        return original(url, data, timeout)

    monkeypatch.setattr(gcal, "_post_form", blocked)
    result = []
    t = threading.Thread(target=lambda: result.append(client.get("/api/google/callback", params={"code": "late", "state": q["state"][0]})))
    t.start()
    try:
        assert entered.wait(5)
        assert client.post("/api/google/disconnect", headers=h).json()["removed"] is True
    finally:
        release.set()
        t.join(5)
    assert "cancelled by Disconnect" in result[0].text and "Connected" not in result[0].text
    assert client.get("/api/google/status", headers=h).json()["connected"] is False
    # the grant Google just issued is revoked rather than left alive
    assert any(p[0] == gcal.REVOKE_URL and p[1] == {"token": "RT-secret"} for p in g.posts[1:])
    # a NEW sign-in after the disconnect works again
    q2, _ = start(client, h)
    assert "Connected read-only" in client.get("/api/google/callback", params={"code": "new", "state": q2["state"][0]}).text
    assert client.get("/api/google/status", headers=h).json()["connected"] is True


def test_disconnect_of_one_user_does_not_cancel_anothers_sign_in(client, on, g):
    a, b = login(client), login(client)
    qa, _ = start(client, a)
    client.post("/api/google/disconnect", headers=b)
    assert "Connected read-only" in client.get("/api/google/callback", params={"code": "x", "state": qa["state"][0]}).text


def test_key_check_fails_closed_when_key_missing_or_invalid(client, on, g, monkeypatch):
    from app import gcal_admin

    connected(client, g)
    monkeypatch.delenv("SYNC_SECRET_KEYS")
    with pytest.raises(RuntimeError):
        gcal.unrotated_count()
    assert gcal_admin.main(["x", "check"]) == 2
    monkeypatch.setenv("SYNC_SECRET_KEYS", "garbage")
    with pytest.raises(RuntimeError):
        gcal.unrotated_count()
    assert gcal_admin.main(["x", "check"]) == 2


def test_key_check_with_nothing_stored_is_zero_even_without_key(client, on, monkeypatch):
    from app import gcal_admin

    monkeypatch.delenv("SYNC_SECRET_KEYS")
    assert gcal.unrotated_count() == 0
    assert gcal_admin.main(["x", "check"]) == 0
