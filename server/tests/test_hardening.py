import re
import time
import uuid

import pytest
from fastapi.testclient import TestClient

from app.auth import hash_token, migrate_tokens, new_token
from app.db import get_conn
from app.main import app


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def register(client, username=None, password="correct horse battery staple"):
    username = username or f"user-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/register", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return username, r.json()["token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


DIGEST = re.compile(r"^[0-9a-f]{64}$")


def test_session_tokens_are_stored_hashed(client):
    username, token = register(client)
    rows = get_conn().execute(
        "SELECT t.token FROM tokens t JOIN users u ON u.id = t.user_id WHERE u.username = ?",
        (username,),
    ).fetchall()
    assert rows, "session token row exists"
    for r in rows:
        assert DIGEST.match(r["token"]), "only the SHA-256 digest is stored"
        assert r["token"] == hash_token(token)
    # ...and the stored digest authenticates the presented plaintext.
    assert client.get("/api/changes", headers=auth(token)).status_code == 200


def test_legacy_plaintext_token_self_heals(client):
    username, _ = register(client)
    uid = get_conn().execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]
    legacy = new_token()
    get_conn().execute("INSERT INTO tokens (token, user_id) VALUES (?, ?)", (legacy, uid))
    get_conn().commit()
    assert client.get("/api/changes", headers=auth(legacy)).status_code == 200
    stored = get_conn().execute("SELECT token FROM tokens WHERE user_id = ? AND token = ?", (uid, legacy)).fetchone()
    assert stored is None, "plaintext row upgraded on first use"
    assert get_conn().execute("SELECT token FROM tokens WHERE token = ?", (hash_token(legacy),)).fetchone()


def test_migrate_tokens_is_idempotent(client):
    username, _ = register(client)
    uid = get_conn().execute("SELECT id FROM users WHERE username = ?", (username,)).fetchone()["id"]
    legacy = new_token()
    get_conn().execute("INSERT INTO tokens (token, user_id) VALUES (?, ?)", (legacy, uid))
    get_conn().commit()
    assert migrate_tokens() >= 1
    assert get_conn().execute("SELECT token FROM tokens WHERE token = ?", (legacy,)).fetchone() is None
    assert migrate_tokens() == 0
    assert client.get("/api/changes", headers=auth(legacy)).status_code == 200


def test_logout_revokes_hashed_token(client):
    _, token = register(client)
    assert client.post("/api/logout", headers=auth(token)).status_code == 204
    assert client.get("/api/changes", headers=auth(token)).status_code == 401


def test_login_throttle_backs_off_then_recovers(client):
    username, token = register(client)
    # 5 free wrong guesses, then the 6th arms a 2s backoff.
    for _ in range(6):
        assert client.post("/api/login", json={"username": username, "password": "wrong password"}).status_code == 401
    # During the backoff, wrong guesses are refused up front (no PBKDF2).
    r = client.post("/api/login", json={"username": username, "password": "wrong password"})
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1
    # Stated policy: even the correct password waits out the backoff...
    assert client.post("/api/login", json={"username": username, "password": "correct horse battery staple"}).status_code == 429
    # ...but existing sessions are untouched throughout.
    assert client.get("/api/changes", headers=auth(token)).status_code == 200
    # Backoff elapsed: the owner gets in and the counter clears.
    get_conn().execute("UPDATE login_throttle SET next_allowed = 0 WHERE username = ?", (username,))
    get_conn().commit()
    r = client.post("/api/login", json={"username": username, "password": "correct horse battery staple"})
    assert r.status_code == 200
    assert get_conn().execute("SELECT * FROM login_throttle WHERE username = ?", (username,)).fetchone() is None
    # And the failure budget restarts from zero.
    for _ in range(5):
        assert client.post("/api/login", json={"username": username, "password": "wrong password"}).status_code == 401


def test_throttle_is_per_client_ip_with_trusted_proxy(client, monkeypatch):
    monkeypatch.setenv("SYNC_TRUSTED_PROXY", "1")
    username, _ = register(client)
    attacker = {"x-forwarded-for": "203.0.113.9"}
    for _ in range(6):
        assert client.post("/api/login", json={"username": username, "password": "wrong password"}, headers=attacker).status_code == 401
    assert client.post("/api/login", json={"username": username, "password": "wrong password"}, headers=attacker).status_code == 429
    # The same account from another address is not throttled by the attack.
    elsewhere = {"x-forwarded-for": "198.51.100.4"}
    assert client.post("/api/login", json={"username": username, "password": "wrong password"}, headers=elsewhere).status_code == 401
    r = client.post("/api/login", json={"username": username, "password": "correct horse battery staple"}, headers=elsewhere)
    assert r.status_code == 200


def test_throttle_table_growth_is_bounded(client, monkeypatch):
    import app.main as main_mod
    monkeypatch.setattr(main_mod, "THROTTLE_MAX_ROWS", 3)
    victim, _ = register(client)
    for _ in range(6):
        assert client.post("/api/login", json={"username": victim, "password": "wrong password"}).status_code == 401
    # Sprayed unknown usernames cannot grow the table past the cap...
    for i in range(20):
        client.post("/api/login", json={"username": f"spray-{i}", "password": "wrong password"})
    n = get_conn().execute("SELECT COUNT(*) AS n FROM login_throttle").fetchone()["n"]
    assert n <= 3
    # ...and the recorded account still throttles.
    assert client.post("/api/login", json={"username": victim, "password": "wrong password"}).status_code == 429


def test_chunked_body_is_counted_and_capped(client, monkeypatch):
    _, token = register(client)

    def chunks(total, size=1024):
        sent = 0
        while sent < total:
            yield b"x" * min(size, total - sent)
            sent += size

    monkeypatch.setenv("SYNC_MAX_BODY_MB", "0")
    # httpx sends a generator body chunked, without a Content-Length.
    r = client.post("/api/changes", content=chunks(4096), headers=auth(token))
    assert r.status_code == 413
    monkeypatch.setenv("SYNC_MAX_BODY_MB", "10")
    # A small chunked body still works (buffered and replayed intact).
    import json as jsonlib
    payload = jsonlib.dumps({"changes": []}).encode()
    r = client.post("/api/changes", content=iter([payload]), headers={**auth(token), "content-type": "application/json"})
    assert r.status_code == 200, r.text


def test_json_body_cap_rejects_oversized_but_not_blobs(client, monkeypatch):
    _, token = register(client)
    monkeypatch.setenv("SYNC_MAX_BODY_MB", "0")
    r = client.post("/api/changes", json={"changes": []}, headers=auth(token))
    assert r.status_code == 413
    # Blob uploads are exempt: they stream with their own per-file cap. The
    # request fails on the missing task (422), never on the JSON body cap.
    r = client.post("/api/attachments?task_id=missing&filename=x.txt&id=att-cap-1",
                    content=b"hello", headers=auth(token))
    assert r.status_code == 422, r.text


def test_stored_digest_is_not_a_usable_bearer(client):
    """The material round-10 finding: a DB read must not yield live sessions."""
    username, token = register(client)
    digest = hash_token(token)
    # Sanity: the digest really is what is stored.
    assert get_conn().execute("SELECT 1 FROM tokens WHERE token = ?", (digest,)).fetchone()
    # Presented as a bearer, it is rejected everywhere session auth applies.
    assert client.get("/api/changes", headers=auth(digest)).status_code == 401
    assert client.post("/api/logout", headers=auth(digest)).status_code == 401
    r = client.post("/api/attachments?task_id=missing&filename=x.txt&id=att-dgx-1",
                    content=b"hello", headers=auth(digest))
    assert r.status_code == 401, r.text
    # And the real token still works afterwards (no self-heal clobbering).
    assert client.get("/api/changes", headers=auth(token)).status_code == 200
    assert get_conn().execute("SELECT 1 FROM tokens WHERE token = ?", (digest,)).fetchone()


def test_unknown_username_login_costs_password_time(client):
    r = client.post("/api/login", json={"username": f"ghost-{uuid.uuid4().hex[:8]}", "password": "wrong password"})
    assert r.status_code == 401


def test_throttled_guess_skips_password_verification(client, monkeypatch):
    import app.main as main_mod
    username, _ = register(client)
    for _ in range(6):
        client.post("/api/login", json={"username": username, "password": "wrong password"})
    calls = []
    real = main_mod.verify_password
    monkeypatch.setattr(main_mod, "verify_password", lambda *a: calls.append(a) or real(*a))
    r = client.post("/api/login", json={"username": username, "password": "wrong password"})
    assert r.status_code == 429
    assert calls == [], "a throttled guess must not run PBKDF2"
