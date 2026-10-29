import json
import sqlite3
import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.db import get_conn


@pytest.fixture()
def client():
    with TestClient(app) as c:
        yield c


def register(client, username=None, password="correct horse battery staple"):
    username = username or f"user-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/register", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


def auth(token):
    return {"Authorization": f"Bearer {token}"}


def make_key(client, session, name="tester", scope="read-write"):
    r = client.post("/api/agent-tokens", json={"name": name, "scope": scope}, headers=auth(session))
    assert r.status_code == 201, r.text
    return r.json()


def seed_inbox(client, session):
    # Sync push of the Inbox project the app seeds on every device.
    r = client.post("/api/changes", json={"changes": [{
        "collection": "projects", "id": "inbox", "base_rev": 0, "deleted": False,
        "data": {"id": "inbox", "name": "Inbox", "color": "#0f766e", "order": 0, "archived": False},
    }]}, headers=auth(session))
    assert r.status_code == 200, r.text


# ---------- token management ----------

def test_token_create_list_revoke_and_scope(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    assert key["token"].startswith("ldk_")
    listed = client.get("/api/agent-tokens", headers=auth(session)).json()["tokens"]
    assert len(listed) == 1 and listed[0]["name"] == "tester" and listed[0]["scope"] == "read-write"
    assert "token" not in listed[0] and "token_hash" not in listed[0]

    # The stored value is a hash, not the raw token.
    row = get_conn().execute("SELECT token_hash FROM agent_tokens WHERE id = ?", (key["id"],)).fetchone()
    assert row["token_hash"] != key["token"] and len(row["token_hash"]) == 64

    # Read works; a read-only key cannot write.
    ro = make_key(client, session, name="reader", scope="read")
    assert client.get("/api/agent/collections", headers=auth(ro["token"])).status_code == 200
    r = client.post("/api/agent/tasks", json={"title": "nope"}, headers=auth(ro["token"]))
    assert r.status_code == 403

    # Revocation kills the key; unknown keys 404; other users cannot see it.
    r = client.post(f"/api/agent-tokens/{key['id']}/revoke", headers=auth(session))
    assert r.status_code == 204
    assert client.get("/api/agent/collections", headers=auth(key["token"])).status_code == 401
    assert client.post(f"/api/agent-tokens/{key['id']}/revoke", headers=auth(session)).status_code == 204
    other = register(client)
    assert client.post(f"/api/agent-tokens/{key['id']}/revoke", headers=auth(other)).status_code == 404


def test_agent_auth_rejects_session_token_and_garbage(client):
    session = register(client)
    assert client.get("/api/agent/collections", headers=auth(session)).status_code == 401
    assert client.get("/api/agent/collections", headers=auth("ldk_nonsense")).status_code == 401
    assert client.get("/api/agent/collections").status_code == 401


def test_last_used_updates(client):
    session = register(client)
    key = make_key(client, session)
    before = client.get("/api/agent-tokens", headers=auth(session)).json()["tokens"][0]
    assert before["last_used_at"] is None
    client.get("/api/agent/collections", headers=auth(key["token"]))
    after = client.get("/api/agent-tokens", headers=auth(session)).json()["tokens"][0]
    assert after["last_used_at"] is not None


# ---------- task operations ----------

def test_task_create_defaults_and_order(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    r = client.post("/api/agent/tasks", json={"title": "  Water plants  ", "tags": ["#Home", "home "]}, headers=auth(key["token"]))
    assert r.status_code == 201, r.text
    t = r.json()
    assert t["title"] == "Water plants" and t["projectId"] == "inbox"
    assert t["status"] == "active" and t["order"] == 1 and t["tags"] == ["home"]
    r2 = client.post("/api/agent/tasks", json={"title": "Second"}, headers=auth(key["token"]))
    assert r2.json()["order"] == 2
    # Validation failures
    assert client.post("/api/agent/tasks", json={"title": "  "}, headers=auth(key["token"])).status_code == 422
    assert client.post("/api/agent/tasks", json={"title": "x", "dueDate": "2026-13-40"}, headers=auth(key["token"])).status_code == 422
    assert client.post("/api/agent/tasks", json={"title": "x", "projectId": "ghost"}, headers=auth(key["token"])).status_code == 422
    assert client.post("/api/agent/tasks", json={"title": "x", "recurrence": "RRULE:FREQ=NOPE"}, headers=auth(key["token"])).status_code == 422


def test_task_complete_spawns_next_occurrence(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    t = client.post("/api/agent/tasks", json={
        "title": "Daily standup", "dueDate": "2026-10-28",
        "recurrence": "DTSTART:20261028T120000Z\nRRULE:FREQ=DAILY",
    }, headers=auth(key["token"])).json()
    r = client.post(f"/api/agent/tasks/{t['id']}/complete", json={"today": "2026-10-29"}, headers=auth(key["token"]))
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["changed"] is True
    assert body["task"]["status"] == "done" and body["task"]["completedAt"]
    spawned = body["spawned"]
    assert spawned["dueDate"] == "2026-10-30"  # strictly after max(due, today)
    assert spawned["seriesId"] == t["id"] and spawned["status"] == "active"
    # Second complete is a no-op, not a duplicate spawn.
    r2 = client.post(f"/api/agent/tasks/{t['id']}/complete", json={"today": "2026-10-29"}, headers=auth(key["token"]))
    assert r2.json()["changed"] is False


def test_task_complete_monthly_clamp(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    t = client.post("/api/agent/tasks", json={
        "title": "Rent", "dueDate": "2026-01-31",
        "recurrence": "DTSTART:20260131T120000Z\nRRULE:FREQ=MONTHLY;BYMONTHDAY=31",
    }, headers=auth(key["token"])).json()
    r = client.post(f"/api/agent/tasks/{t['id']}/complete", json={"today": "2026-01-31"}, headers=auth(key["token"]))
    assert r.json()["spawned"]["dueDate"] == "2026-02-28"  # clamped, not skipped to March 31


def test_task_uncomplete_keeps_spawn(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    t = client.post("/api/agent/tasks", json={
        "title": "D", "dueDate": "2026-10-28", "recurrence": "DTSTART:20261028T120000Z\nRRULE:FREQ=DAILY",
    }, headers=auth(key["token"])).json()
    done = client.post(f"/api/agent/tasks/{t['id']}/complete", json={"today": "2026-10-28"}, headers=auth(key["token"])).json()
    r = client.post(f"/api/agent/tasks/{t['id']}/uncomplete", headers=auth(key["token"]))
    assert r.json()["changed"] is True and r.json()["task"]["status"] == "active"
    # The spawned occurrence survives the undo, matching the app.
    assert client.get(f"/api/agent/entities/tasks/{done['spawned']['id']}", headers=auth(key["token"])).status_code == 200


def test_task_skip_records_and_advances(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    t = client.post("/api/agent/tasks", json={
        "title": "D", "dueDate": "2026-10-28", "recurrence": "DTSTART:20261028T120000Z\nRRULE:FREQ=DAILY",
    }, headers=auth(key["token"])).json()
    r = client.post(f"/api/agent/tasks/{t['id']}/skip", json={"today": "2026-10-28"}, headers=auth(key["token"]))
    assert r.json()["task"]["dueDate"] == "2026-10-29"
    assert r.json()["task"]["skippedDates"] == ["2026-10-28"]
    plain = client.post("/api/agent/tasks", json={"title": "plain"}, headers=auth(key["token"])).json()
    assert client.post(f"/api/agent/tasks/{plain['id']}/skip", json={}, headers=auth(key["token"])).status_code == 409


def test_task_patch_cycle_and_clear(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    a = client.post("/api/agent/tasks", json={"title": "A", "dueDate": "2026-11-01"}, headers=auth(key["token"])).json()
    b = client.post("/api/agent/tasks", json={"title": "B"}, headers=auth(key["token"])).json()
    # Clear a due date with explicit null.
    r = client.patch(f"/api/agent/tasks/{a['id']}", json={"dueDate": None}, headers=auth(key["token"]))
    assert r.json()["task"]["dueDate"] is None
    # blockedBy cycle refused.
    assert client.patch(f"/api/agent/tasks/{a['id']}", json={"blockedBy": [b["id"]]}, headers=auth(key["token"])).status_code == 200
    r = client.patch(f"/api/agent/tasks/{b['id']}", json={"blockedBy": [a["id"]]}, headers=auth(key["token"]))
    assert r.status_code == 422
    # Self-parent refused; status via patch refused.
    assert client.patch(f"/api/agent/tasks/{a['id']}", json={"parentId": a["id"]}, headers=auth(key["token"])).status_code == 422
    assert client.patch(f"/api/agent/tasks/{a['id']}", json={"status": "done"}, headers=auth(key["token"])).status_code == 422
    assert client.patch(f"/api/agent/tasks/{a['id']}", json={"status": "archived"}, headers=auth(key["token"])).json()["task"]["status"] == "archived"


# ---------- habits / projects / goals / notes / journal ----------

def test_habit_checkin_idempotent(client):
    session = register(client)
    key = make_key(client, session)
    h = client.post("/api/agent/habits", json={"name": "Run", "weekdays": [1, 3, 5]}, headers=auth(key["token"])).json()
    assert h["order"] == 0 and h["archived"] is False
    r1 = client.post(f"/api/agent/habits/{h['id']}/check", json={"date": "2026-10-29"}, headers=auth(key["token"]))
    r2 = client.post(f"/api/agent/habits/{h['id']}/check", json={"date": "2026-10-29"}, headers=auth(key["token"]))
    assert r1.json()["changed"] is True and r2.json()["changed"] is False
    assert r1.json()["log"]["id"] == f"{h['id']}:2026-10-29"
    r3 = client.post(f"/api/agent/habits/{h['id']}/uncheck", json={"date": "2026-10-29"}, headers=auth(key["token"]))
    assert r3.json()["changed"] is True
    r4 = client.post(f"/api/agent/habits/{h['id']}/uncheck", json={"date": "2026-10-29"}, headers=auth(key["token"]))
    assert r4.json()["changed"] is False
    assert client.post("/api/agent/habits", json={"name": "x", "weekdays": [7]}, headers=auth(key["token"])).status_code == 422
    # Archive via patch.
    r = client.patch(f"/api/agent/habits/{h['id']}", json={"archived": True}, headers=auth(key["token"]))
    assert r.json()["habit"]["archived"] is True


def test_project_cycle_and_delete_policy(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    parent = client.post("/api/agent/projects", json={"name": "Side"}, headers=auth(key["token"])).json()
    child = client.post("/api/agent/projects", json={"name": "Lifedash", "parentId": parent["id"]}, headers=auth(key["token"])).json()
    # Moving the parent under its own child is refused.
    assert client.patch(f"/api/agent/projects/{parent['id']}", json={"parentId": child["id"]}, headers=auth(key["token"])).status_code == 422
    task = client.post("/api/agent/tasks", json={"title": "T", "projectId": parent["id"]}, headers=auth(key["token"])).json()
    # Delete parent: its tasks tombstoned, subproject reparented up (stays intact).
    r = client.request("DELETE", f"/api/agent/entities/projects/{parent['id']}", headers=auth(key["token"]))
    assert r.status_code == 200, r.text
    assert set(r.json()["tombstoned"]) == {parent["id"], task["id"]}
    after = client.get(f"/api/agent/entities/projects/{child['id']}", headers=auth(key["token"])).json()
    assert after["data"]["parentId"] is None
    assert client.get(f"/api/agent/entities/tasks/{task['id']}", headers=auth(key["token"])).json()["deleted"] is True


def test_task_delete_strips_blockers(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    blocker = client.post("/api/agent/tasks", json={"title": "blocker"}, headers=auth(key["token"])).json()
    blocked = client.post("/api/agent/tasks", json={"title": "blocked"}, headers=auth(key["token"])).json()
    client.patch(f"/api/agent/tasks/{blocked['id']}", json={"blockedBy": [blocker["id"]]}, headers=auth(key["token"]))
    client.request("DELETE", f"/api/agent/entities/tasks/{blocker['id']}", headers=auth(key["token"]))
    after = client.get(f"/api/agent/entities/tasks/{blocked['id']}", headers=auth(key["token"])).json()
    assert after["data"]["blockedBy"] == []


def test_goal_note_journal_flow(client):
    session = register(client)
    key = make_key(client, session)
    g = client.post("/api/agent/goals", json={"title": "Ship", "targetDate": "2026-12-31"}, headers=auth(key["token"])).json()
    assert client.patch(f"/api/agent/goals/{g['id']}", json={"status": "done"}, headers=auth(key["token"])).json()["goal"]["status"] == "done"
    assert client.patch(f"/api/agent/goals/{g['id']}", json={"status": "weird"}, headers=auth(key["token"])).status_code == 422

    n = client.post("/api/agent/notes", json={"title": "Ideas", "note": "plain text"}, headers=auth(key["token"])).json()
    assert client.patch(f"/api/agent/notes/{n['id']}", json={"note": "updated"}, headers=auth(key["token"])).json()["changed"] is True

    j1 = client.put("/api/agent/journal/2026-10-29", json={"mood": 4, "note": "Good day"}, headers=auth(key["token"]))
    assert j1.json()["created"] is True
    j2 = client.put("/api/agent/journal/2026-10-29", json={"mood": 5}, headers=auth(key["token"]))
    assert j2.json()["created"] is False and j2.json()["entry"]["id"] == j1.json()["entry"]["id"]
    assert j2.json()["entry"]["note"] == "Good day" and j2.json()["entry"]["mood"] == 5
    assert client.put("/api/agent/journal/2026-10-29", json={"mood": 9}, headers=auth(key["token"])).status_code == 422


# ---------- sync integration + audit ----------

def test_agent_writes_visible_to_sync_pull_and_tombstones(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    t = client.post("/api/agent/tasks", json={"title": "From agent"}, headers=auth(key["token"])).json()
    pull = client.get("/api/changes?since=0", headers=auth(session)).json()
    ids = [(c["collection"], c["id"]) for c in pull["changes"]]
    assert ("tasks", t["id"]) in ids
    client.request("DELETE", f"/api/agent/entities/tasks/{t['id']}", headers=auth(key["token"]))
    pull2 = client.get(f"/api/changes?since={pull['rev']}", headers=auth(session)).json()
    tomb = [c for c in pull2["changes"] if c["collection"] == "tasks" and c["id"] == t["id"]]
    assert tomb and tomb[0]["deleted"] is True


def test_audit_records_writes_not_reads(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    tid = key["id"]
    count = "SELECT COUNT(*) AS n FROM agent_audit WHERE token_id = ?"
    client.get("/api/agent/collections", headers=auth(key["token"]))
    assert get_conn().execute(count, (tid,)).fetchone()["n"] == 0
    client.post("/api/agent/tasks", json={"title": "audited"}, headers=auth(key["token"])).json()
    rows = get_conn().execute(
        "SELECT action, collection FROM agent_audit WHERE token_id = ?", (tid,)).fetchall()
    assert [(r["action"], r["collection"]) for r in rows] == [("task.create", "tasks")]
