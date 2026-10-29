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


def test_login_throttle_locks_then_recovers(client):
    username, _ = register(client)
    for _ in range(10):
        r = client.post("/api/login", json={"username": username, "password": "wrong password"})
        assert r.status_code == 401
    r = client.post("/api/login", json={"username": username, "password": "wrong password"})
    assert r.status_code == 429
    # Even the right password is throttled inside the window...
    r = client.post("/api/login", json={"username": username, "password": "correct horse battery staple"})
    assert r.status_code == 429
    # ...but the window expiring restores access; no permanent lockout.
    get_conn().execute("UPDATE login_attempts SET window_start = ? WHERE username = ?", (time.time() - 700, username))
    get_conn().commit()
    r = client.post("/api/login", json={"username": username, "password": "correct horse battery staple"})
    assert r.status_code == 200
    assert get_conn().execute("SELECT * FROM login_attempts WHERE username = ?", (username,)).fetchone() is None


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
