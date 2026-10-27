import uuid

import pytest
from fastapi.testclient import TestClient

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


def test_health(client):
    assert client.get("/api/health").json() == {"ok": True}


def test_register_login_and_wrong_password(client):
    username, _ = register(client)
    r = client.post("/api/login", json={"username": username, "password": "correct horse battery staple"})
    assert r.status_code == 200
    assert r.json()["token"]
    r = client.post("/api/login", json={"username": username, "password": "wrong password"})
    assert r.status_code == 401


def test_duplicate_username_rejected(client):
    username, _ = register(client)
    r = client.post("/api/register", json={"username": username, "password": "another password"})
    assert r.status_code == 409


def test_registration_closed_after_first_user(client, monkeypatch):
    monkeypatch.setenv("SYNC_OPEN_REGISTRATION", "0")
    r = client.post("/api/register", json={"username": f"late-{uuid.uuid4().hex[:8]}", "password": "some password"})
    assert r.status_code == 403


def test_auth_required(client):
    assert client.get("/api/changes").status_code == 401
    assert client.get("/api/changes", headers=auth("nope")).status_code == 401
    assert client.post("/api/changes", json={"changes": []}).status_code == 401


def test_logout_revokes_only_the_presented_token(client):
    username, token = register(client)
    assert client.get("/api/changes", headers=auth(token)).status_code == 200
    assert client.post("/api/logout", headers=auth(token)).status_code == 204
    assert client.get("/api/changes", headers=auth(token)).status_code == 401
    # A fresh login for the same user gets an independent, still-valid token.
    r = client.post("/api/login", json={"username": username, "password": "correct horse battery staple"})
    assert r.status_code == 200
    token2 = r.json()["token"]
    assert token2 != token
    assert client.get("/api/changes", headers=auth(token2)).status_code == 200


def test_logout_rejects_missing_or_unknown_token(client):
    assert client.post("/api/logout").status_code == 401
    assert client.post("/api/logout", headers=auth("no-such-token")).status_code == 401


def test_push_and_pull_roundtrip(client):
    _, token = register(client)
    task_id = uuid.uuid4().hex
    r = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "tasks", "id": task_id, "base_rev": 0,
         "data": {"title": "Write tests", "status": "todo"}},
    ]})
    assert r.json()["results"][0] == {"collection": "tasks", "id": task_id, "status": "ok", "rev": 1}

    r = client.get("/api/changes?since=0", headers=auth(token))
    body = r.json()
    assert body["rev"] == 1
    assert body["changes"] == [{"collection": "tasks", "id": task_id, "rev": 1,
                                "deleted": False, "data": {"title": "Write tests", "status": "todo"}}]
    assert client.get("/api/changes?since=1", headers=auth(token)).json()["changes"] == []


def test_update_with_correct_base_rev(client):
    _, token = register(client)
    tid = uuid.uuid4().hex
    client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "tasks", "id": tid, "base_rev": 0, "data": {"title": "v1"}}]})
    r = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "tasks", "id": tid, "base_rev": 1, "data": {"title": "v2"}}]})
    assert r.json()["results"][0]["status"] == "ok"
    assert r.json()["results"][0]["rev"] == 2
    # pull returns the latest state of each entity changed since the cursor
    changes = client.get("/api/changes?since=0", headers=auth(token)).json()["changes"]
    assert changes == [{"collection": "tasks", "id": tid, "rev": 2,
                        "deleted": False, "data": {"title": "v2"}}]
    # a client that already has rev 1 only needs the delta
    delta = client.get("/api/changes?since=1", headers=auth(token)).json()["changes"]
    assert [c["rev"] for c in delta] == [2]


def test_conflict_on_stale_base_rev(client):
    _, token = register(client)
    tid = uuid.uuid4().hex
    client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "tasks", "id": tid, "base_rev": 0, "data": {"title": "server v1"}}]})
    r = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "tasks", "id": tid, "base_rev": 0, "data": {"title": "stale write"}}]})
    result = r.json()["results"][0]
    assert result["status"] == "conflict"
    assert result["current"]["rev"] == 1
    assert result["current"]["data"]["title"] == "server v1"
    # server version untouched
    changes = client.get("/api/changes?since=0", headers=auth(token)).json()["changes"]
    assert changes[0]["data"]["title"] == "server v1"


def test_delete_tombstone(client):
    _, token = register(client)
    tid = uuid.uuid4().hex
    client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "tasks", "id": tid, "base_rev": 0, "data": {"title": "bye"}}]})
    r = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "tasks", "id": tid, "base_rev": 1, "deleted": True, "data": {}}]})
    assert r.json()["results"][0]["status"] == "ok"
    changes = client.get("/api/changes?since=0", headers=auth(token)).json()["changes"]
    assert changes[-1]["deleted"] is True


def test_user_isolation(client):
    _, token1 = register(client)
    _, token2 = register(client)
    client.post("/api/changes", headers=auth(token1), json={"changes": [
        {"collection": "tasks", "id": uuid.uuid4().hex, "base_rev": 0, "data": {"title": "private"}}]})
    body = client.get("/api/changes?since=0", headers=auth(token2)).json()
    assert body["changes"] == []
    assert body["rev"] == 0


def test_unknown_collection_reported_not_applied(client):
    _, token = register(client)
    r = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "widgets", "id": uuid.uuid4().hex, "base_rev": 0, "data": {}}]})
    assert r.json()["results"][0]["status"] == "unknown_collection"


def test_password_validation(client):
    r = client.post("/api/register", json={"username": "x", "password": "short"})
    assert r.status_code == 422


def test_habits_collections_accepted(client):
    _, token = register(client)
    r = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "habits", "id": uuid.uuid4().hex, "base_rev": 0, "data": {"name": "Read"}},
        {"collection": "habitLogs", "id": uuid.uuid4().hex, "base_rev": 0, "data": {"habitId": "h1", "date": "2026-10-20"}},
    ]})
    statuses = [x["status"] for x in r.json()["results"]]
    assert statuses == ["ok", "ok"]
    body = client.get("/api/changes?since=0", headers=auth(token)).json()
    assert {c["collection"] for c in body["changes"]} == {"habits", "habitLogs"}


def test_goals_notes_journal_collections_accepted(client):
    _, token = register(client)
    r = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "goals", "id": uuid.uuid4().hex, "base_rev": 0, "data": {"title": "Run a marathon"}},
        {"collection": "notes", "id": uuid.uuid4().hex, "base_rev": 0, "data": {"title": "Ideas", "body": "..."}},
        {"collection": "journal", "id": uuid.uuid4().hex, "base_rev": 0, "data": {"date": "2026-10-20", "body": "..."}},
    ]})
    statuses = [x["status"] for x in r.json()["results"]]
    assert statuses == ["ok", "ok", "ok"]
    body = client.get("/api/changes?since=0", headers=auth(token)).json()
    assert {c["collection"] for c in body["changes"]} == {"goals", "notes", "journal"}


def test_notes_conflict_and_journal_tombstone(client):
    _, token = register(client)
    note_id = uuid.uuid4().hex
    client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "notes", "id": note_id, "base_rev": 0, "data": {"title": "server v1"}}]})
    r = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "notes", "id": note_id, "base_rev": 0, "data": {"title": "stale write"}}]})
    result = r.json()["results"][0]
    assert result["status"] == "conflict"
    assert result["current"]["rev"] == 1
    assert result["current"]["data"]["title"] == "server v1"

    entry_id = uuid.uuid4().hex
    created = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "journal", "id": entry_id, "base_rev": 0, "data": {"date": "2026-10-20"}}]})
    # rev is a per-user global sequence: a create after other writes does not get rev 1
    entry_rev = created.json()["results"][0]["rev"]
    r = client.post("/api/changes", headers=auth(token), json={"changes": [
        {"collection": "journal", "id": entry_id, "base_rev": entry_rev, "deleted": True, "data": {}}]})
    assert r.json()["results"][0]["status"] == "ok"
    changes = client.get("/api/changes?since=0", headers=auth(token)).json()["changes"]
    assert changes[-1]["collection"] == "journal"
    assert changes[-1]["deleted"] is True
