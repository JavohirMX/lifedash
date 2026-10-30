import hashlib
import json
import os
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


# ---------- security boundaries ----------

def test_cross_user_isolation(client):
    """User A's agent key must see none of user B's data, in either direction."""
    session_a = register(client)
    seed_inbox(client, session_a)
    key_a = make_key(client, session_a)
    task_a = client.post("/api/agent/tasks", json={"title": "A secret"}, headers=auth(key_a["token"])).json()

    session_b = register(client)
    seed_inbox(client, session_b)
    key_b = make_key(client, session_b)

    # B cannot read A's task by id, and B's list contains none of A's data.
    assert client.get(f"/api/agent/entities/tasks/{task_a['id']}", headers=auth(key_b["token"])).status_code == 404
    listed = client.get("/api/agent/entities/tasks", headers=auth(key_b["token"])).json()["entities"]
    assert all(e["id"] != task_a["id"] for e in listed)
    # B cannot mutate or delete A's task.
    assert client.patch(f"/api/agent/tasks/{task_a['id']}", json={"title": "hijack"}, headers=auth(key_b["token"])).status_code == 404
    assert client.post(f"/api/agent/tasks/{task_a['id']}/complete", json={}, headers=auth(key_b["token"])).status_code == 404
    assert client.request("DELETE", f"/api/agent/entities/tasks/{task_a['id']}", headers=auth(key_b["token"])).status_code == 404
    # A's task is untouched.
    after = client.get(f"/api/agent/entities/tasks/{task_a['id']}", headers=auth(key_a["token"])).json()
    assert after["data"]["title"] == "A secret"
    # B cannot manage A's keys.
    keys_b = client.get("/api/agent-tokens", headers=auth(session_b)).json()["tokens"]
    assert all(k["id"] != key_a["id"] for k in keys_b)


def test_endpoint_separation(client):
    """Agent keys never manage keys; session tokens never act as agents."""
    session = register(client)
    key = make_key(client, session)
    # Agent key cannot create/list/revoke keys.
    assert client.post("/api/agent-tokens", json={"name": "escalation", "scope": "read-write"}, headers=auth(key["token"])).status_code == 401
    assert client.get("/api/agent-tokens", headers=auth(key["token"])).status_code == 401
    assert client.post(f"/api/agent-tokens/{key['id']}/revoke", headers=auth(key["token"])).status_code == 401
    # Session token cannot use agent endpoints.
    assert client.get("/api/agent/collections", headers=auth(session)).status_code == 401
    assert client.post("/api/agent/tasks", json={"title": "x"}, headers=auth(session)).status_code == 401
    # Agent key cannot push raw sync changes (raw writes stay client-only).
    r = client.post("/api/changes", json={"changes": [{"collection": "tasks", "id": "raw", "base_rev": 0, "data": {"title": "raw"}}]}, headers=auth(key["token"]))
    assert r.status_code == 401


def test_revoked_key_dies_immediately(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    assert client.get("/api/agent/collections", headers=auth(key["token"])).status_code == 200
    client.post(f"/api/agent-tokens/{key['id']}/revoke", headers=auth(session))
    assert client.get("/api/agent/collections", headers=auth(key["token"])).status_code == 401
    assert client.post("/api/agent/tasks", json={"title": "x"}, headers=auth(key["token"])).status_code == 401


def test_unknown_collection_and_bad_refs_on_writes(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    assert client.request("DELETE", "/api/agent/entities/whatever/x", headers=auth(key["token"])).status_code == 404
    assert client.get("/api/agent/entities/whatever", headers=auth(key["token"])).status_code == 404
    t = client.post("/api/agent/tasks", json={"title": "T"}, headers=auth(key["token"])).json()
    assert client.patch(f"/api/agent/tasks/{t['id']}", json={"goalId": "ghost"}, headers=auth(key["token"])).status_code == 422
    assert client.post("/api/agent/habits/ghost/check", json={"date": "2026-10-29"}, headers=auth(key["token"])).status_code == 422


def test_oversized_and_malformed_bodies_rejected(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    assert client.post("/api/agent/tasks", json={"title": "x" * 501}, headers=auth(key["token"])).status_code == 422
    assert client.post("/api/agent/tasks", json={"title": "ok", "priority": 9}, headers=auth(key["token"])).status_code == 422
    assert client.post("/api/agent/habits", json={"name": "h", "weekdays": [1, 1]}, headers=auth(key["token"])).status_code == 422
    assert client.put("/api/agent/journal/not-a-date", json={}, headers=auth(key["token"])).status_code == 422


def test_task_create_seeds_inbox_on_fresh_account(client):
    """Fresh account, app never synced: default projectId must still work."""
    session = register(client)  # note: no seed_inbox call
    key = make_key(client, session)
    r = client.post("/api/agent/tasks", json={"title": "First ever"}, headers=auth(key["token"]))
    assert r.status_code == 201, r.text
    assert r.json()["projectId"] == "inbox"
    inbox = client.get("/api/agent/entities/projects/inbox", headers=auth(key["token"])).json()
    assert inbox["data"]["name"] == "Inbox" and inbox["data"]["color"] == "#0f766e"
    # Explicit unknown project still refuses.
    assert client.post("/api/agent/tasks", json={"title": "x", "projectId": "ghost"}, headers=auth(key["token"])).status_code == 422


def test_focus_session_logging(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    t = client.post("/api/agent/tasks", json={"title": "Deep work"}, headers=auth(key["token"])).json()
    body = {"taskId": t["id"], "startedAt": 1761724800000, "endedAt": 1761727500000, "seconds": 2400}
    r = client.post("/api/agent/focus-sessions", json=body, headers=auth(key["token"]))
    assert r.status_code == 201, r.text
    fs = r.json()
    assert fs["taskId"] == t["id"] and fs["seconds"] == 2400
    # Validation: unknown task, inverted span, seconds beyond elapsed, far past.
    assert client.post("/api/agent/focus-sessions", json={**body, "taskId": "ghost"}, headers=auth(key["token"])).status_code == 422
    assert client.post("/api/agent/focus-sessions", json={**body, "endedAt": body["startedAt"]}, headers=auth(key["token"])).status_code == 422
    assert client.post("/api/agent/focus-sessions", json={**body, "seconds": 99999}, headers=auth(key["token"])).status_code == 422
    assert client.post("/api/agent/focus-sessions", json={**body, "startedAt": 100000}, headers=auth(key["token"])).status_code == 422
    # Sync pull carries it; soft delete tombstones it.
    pull = client.get("/api/changes?since=0", headers=auth(session)).json()
    assert any(c["collection"] == "focusSessions" and c["id"] == fs["id"] for c in pull["changes"])
    client.request("DELETE", f"/api/agent/entities/focusSessions/{fs['id']}", headers=auth(key["token"]))
    assert client.get(f"/api/agent/entities/focusSessions/{fs['id']}", headers=auth(key["token"])).json()["deleted"] is True


def test_recurrence_rules_that_used_to_500(client):
    # Reviewer finding: these rules created fine but /complete (and /skip) 500'd.
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    for rule in ("FREQ=DAILY", "DTSTART:20261029T000000\nRRULE:FREQ=DAILY", "RRULE:FREQ=WEEKLY;BYDAY=MO"):
        t = client.post("/api/agent/tasks", json={"title": "r", "recurrence": rule, "dueDate": "2026-10-28"}, headers=h)
        assert t.status_code == 201, (rule, t.text)
        tid = t.json()["id"]
        r = client.post(f"/api/agent/tasks/{tid}/complete", json={"today": "2026-10-29"}, headers=h)
        assert r.status_code == 200, (rule, r.text)
        assert r.json()["spawned"] is not None, rule
        assert r.json()["spawned"]["dueDate"] >= "2026-10-29"  # a no-DTSTART rule may yield later today (client parity)
    # Parses but cannot be evaluated -> rejected at create, not a 500 later.
    bad = client.post("/api/agent/tasks", json={"title": "bad", "recurrence": "FREQ=SECONDLY;BYHOUR=3;BYMINUTE=70"}, headers=h)
    assert bad.status_code == 422
    # An absurd-but-computable rule is accepted (never block creation), and
    # completion still cannot 500 - it just yields no spawn when evaluation fails.
    bad2 = client.post("/api/agent/tasks", json={"title": "bad2", "recurrence": "FREQ=SECONDLY;COUNT=99999999999", "dueDate": "2026-10-28"}, headers=h)
    assert bad2.status_code == 201
    r = client.post(f"/api/agent/tasks/{bad2.json()['id']}/complete", json={"today": "2026-10-29"}, headers=h)
    assert r.status_code == 200


def test_soft_delete_keeps_payload_and_restore_recovers_cascade(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    parent = client.post("/api/agent/tasks", json={"title": "parent"}, headers=h).json()
    sub = client.post("/api/agent/tasks", json={"title": "sub", "parentId": parent["id"]}, headers=h).json()
    client.request("DELETE", f"/api/agent/entities/tasks/{parent['id']}", headers=h)
    gone = client.get(f"/api/agent/entities/tasks/{parent['id']}", headers=h).json()
    assert gone["deleted"] is True and gone["data"]["title"] == "parent"
    r = client.post(f"/api/agent/entities/tasks/{parent['id']}/restore", headers=h)
    assert r.status_code == 200, r.text
    assert set(r.json()["ids"]) == {f"tasks:{parent['id']}", f"tasks:{sub['id']}"}
    assert client.get(f"/api/agent/entities/tasks/{sub['id']}", headers=h).json()["deleted"] is False
    # Second restore is a conflict, not a silent no-op.
    assert client.post(f"/api/agent/entities/tasks/{parent['id']}/restore", headers=h).status_code == 409
    # Unknown entity restore is a 404.
    assert client.post("/api/agent/entities/tasks/ghost/restore", headers=h).status_code == 404
    # Project cascade: own tasks come back; the inbox stays protected.
    proj = client.post("/api/agent/projects", json={"name": "P"}, headers=h).json()
    t = client.post("/api/agent/tasks", json={"title": "pt", "projectId": proj["id"]}, headers=h).json()
    client.request("DELETE", f"/api/agent/entities/projects/{proj['id']}", headers=h)
    rr = client.post(f"/api/agent/entities/projects/{proj['id']}/restore", headers=h)
    assert set(rr.json()["ids"]) == {f"projects:{proj['id']}", f"tasks:{t['id']}"}
    assert client.request("DELETE", "/api/agent/entities/projects/inbox", headers=h).status_code == 422


def test_client_sync_tombstone_keeps_server_payload(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    t = client.post("/api/agent/tasks", json={"title": "keep me"}, headers=auth(key["token"])).json()
    pull = client.get("/api/changes?since=0", headers=auth(session)).json()
    rev = [c for c in pull["changes"] if c["id"] == t["id"]][0]["rev"]
    r = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "tasks", "id": t["id"], "base_rev": rev, "deleted": True, "data": {}}]})
    assert r.json()["results"][0]["status"] == "ok"
    ent = client.get(f"/api/agent/entities/tasks/{t['id']}", headers=auth(key["token"])).json()
    assert ent["deleted"] is True and ent["data"]["title"] == "keep me"
    # Client-tombstoned rows are restorable through the agent API too.
    rr = client.post(f"/api/agent/entities/tasks/{t['id']}/restore", headers=auth(key["token"]))
    assert rr.status_code == 200
    assert client.get(f"/api/agent/entities/tasks/{t['id']}", headers=auth(key["token"])).json()["deleted"] is False


def test_null_patch_semantics(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    t = client.post("/api/agent/tasks", json={"title": "n", "dueDate": "2026-11-01", "priority": 1}, headers=h).json()
    for field in ("title", "note", "projectId", "priority", "pinned", "status", "tags", "blockedBy"):
        r = client.patch(f"/api/agent/tasks/{t['id']}", json={field: None}, headers=h)
        assert r.status_code == 422, (field, r.text)
    # Null clears the nullable-by-design fields.
    r = client.patch(f"/api/agent/tasks/{t['id']}", json={"dueDate": None, "dueTime": None, "parentId": None, "goalId": None}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["task"]["dueDate"] is None
    # Projects/habits/goals/notes: same rule for their non-nullable fields.
    proj = client.post("/api/agent/projects", json={"name": "P"}, headers=h).json()
    assert client.patch(f"/api/agent/projects/{proj['id']}", json={"color": None}, headers=h).status_code == 422
    assert client.patch(f"/api/agent/projects/{proj['id']}", json={"archived": None}, headers=h).status_code == 422
    hab = client.post("/api/agent/habits", json={"name": "H"}, headers=h).json()
    assert client.patch(f"/api/agent/habits/{hab['id']}", json={"color": None}, headers=h).status_code == 422
    goal = client.post("/api/agent/goals", json={"title": "G"}, headers=h).json()
    assert client.patch(f"/api/agent/goals/{goal['id']}", json={"habitIds": None}, headers=h).status_code == 422
    note = client.post("/api/agent/notes", json={"title": "N"}, headers=h).json()
    assert client.patch(f"/api/agent/notes/{note['id']}", json={"pinned": None}, headers=h).status_code == 422


def test_archive_and_unarchive_via_patch(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    t = client.post("/api/agent/tasks", json={"title": "a"}, headers=h).json()
    r = client.patch(f"/api/agent/tasks/{t['id']}", json={"status": "archived"}, headers=h)
    assert r.status_code == 200 and r.json()["task"]["status"] == "archived"
    r = client.patch(f"/api/agent/tasks/{t['id']}", json={"status": "active"}, headers=h)
    assert r.status_code == 200 and r.json()["task"]["status"] == "active"
    # Un-archiving a task that is not archived is a 422, and 'done' stays op-only.
    assert client.patch(f"/api/agent/tasks/{t['id']}", json={"status": "active"}, headers=h).status_code == 422
    assert client.patch(f"/api/agent/tasks/{t['id']}", json={"status": "done"}, headers=h).status_code == 422


def test_color_and_weekday_validation(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    assert client.post("/api/agent/projects", json={"name": "P", "color": "red"}, headers=h).status_code == 422
    assert client.post("/api/agent/projects", json={"name": "P", "color": "#fff"}, headers=h).status_code == 422
    assert client.post("/api/agent/projects", json={"name": "P", "color": "#0F766E"}, headers=h).status_code == 201
    assert client.post("/api/agent/habits", json={"name": "H", "color": "blue"}, headers=h).status_code == 422
    assert client.post("/api/agent/habits", json={"name": "H", "weekdays": [True]}, headers=h).status_code == 422
    assert client.post("/api/agent/habits", json={"name": "H", "weekdays": [1.0]}, headers=h).status_code == 422
    assert client.post("/api/agent/habits", json={"name": "H", "weekdays": [0, 7]}, headers=h).status_code == 422
    assert client.post("/api/agent/habits", json={"name": "H", "weekdays": [1, 1]}, headers=h).status_code == 422
    assert client.post("/api/agent/habits", json={"name": "H", "weekdays": [0, 6]}, headers=h).status_code == 201


def test_read_key_gets_403_before_body_validation(client):
    session = register(client)
    seed_inbox(client, session)
    rkey = make_key(client, session, name="reader", scope="read")
    r = client.post("/api/agent/tasks", json={"bogus": 1}, headers=auth(rkey["token"]))
    assert r.status_code == 403, r.text
    r = client.patch("/api/agent/tasks/whatever", json={"bogus": 1}, headers=auth(rkey["token"]))
    assert r.status_code == 403, r.text


def _setup_scoped(client):
    session = register(client)
    seed_inbox(client, session)
    full = make_key(client, session, name="full")
    h = auth(full["token"])
    p1 = client.post("/api/agent/projects", json={"name": "P1"}, headers=h).json()
    s1 = client.post("/api/agent/projects", json={"name": "S1", "parentId": p1["id"]}, headers=h).json()
    p2 = client.post("/api/agent/projects", json={"name": "P2"}, headers=h).json()
    t1 = client.post("/api/agent/tasks", json={"title": "in p1", "projectId": p1["id"]}, headers=h).json()
    t1s = client.post("/api/agent/tasks", json={"title": "in s1", "projectId": s1["id"]}, headers=h).json()
    t2 = client.post("/api/agent/tasks", json={"title": "in p2", "projectId": p2["id"]}, headers=h).json()
    client.post("/api/agent/habits", json={"name": "H"}, headers=h)
    client.post("/api/agent/notes", json={"title": "N"}, headers=h)
    return session, full, p1, s1, p2, t1, t1s, t2


def test_project_scoped_key_boundaries(client):
    session, full, p1, s1, p2, t1, t1s, t2 = _setup_scoped(client)
    scoped = make_key(client, session, name="scoped", scope="read-write")
    r = client.post("/api/agent-tokens", json={"name": "scoped-p1", "scope": "read-write", "projectId": p1["id"]},
                    headers=auth(session))
    assert r.status_code == 201, r.text
    key = r.json()["token"]
    h = auth(key)
    # Reads: only the subtree's tasks; out-of-scope is 404.
    ids = {e["id"] for e in client.get("/api/agent/entities/tasks", headers=h).json()["entities"]}
    assert ids == {t1["id"], t1s["id"]}
    assert client.get(f"/api/agent/entities/tasks/{t2['id']}", headers=h).status_code == 404
    # Project tree is readable; mutations are allowed only inside the
    # subtree (detailed rules in test_scoped_key_project_mutations).
    assert client.get("/api/agent/entities/projects", headers=h).status_code == 200
    assert client.post("/api/agent/projects", json={"name": "X", "parentId": p1["id"]}, headers=h).status_code == 201
    assert client.post("/api/agent/projects", json={"name": "X2", "parentId": p2["id"]}, headers=h).status_code == 422
    assert client.post("/api/agent/projects", json={"name": "X3"}, headers=h).status_code == 403
    assert client.patch(f"/api/agent/projects/{p1['id']}", json={"name": "Nope"}, headers=h).status_code == 403
    assert client.delete(f"/api/agent/entities/projects/{s1['id']}", headers=h).status_code == 403
    # Global collections are out of reach.
    for method, url, body in (("post", "/api/agent/habits", {"name": "x"}),
                              ("post", "/api/agent/notes", {"title": "x"}),
                              ("put", "/api/agent/journal/2026-10-29", {"note": "x"}),
                              ("post", "/api/agent/goals", {"title": "x"})):
        assert getattr(client, method)(url, json=body, headers=h).status_code == 403, url
    assert client.get("/api/agent/entities/habits", headers=h).status_code == 403
    assert client.get("/api/agent/entities/goals", headers=h).status_code == 403
    # Writes stay inside the subtree.
    ok = client.post("/api/agent/tasks", json={"title": "new", "projectId": s1["id"]}, headers=h)
    assert ok.status_code == 201, ok.text
    assert client.post("/api/agent/tasks", json={"title": "new", "projectId": p2["id"]}, headers=h).status_code == 403
    assert client.post("/api/agent/tasks", json={"title": "new"}, headers=h).status_code == 403  # inbox is outside
    assert client.patch(f"/api/agent/tasks/{t2['id']}", json={"title": "x"}, headers=h).status_code == 404
    assert client.patch(f"/api/agent/tasks/{t1['id']}", json={"projectId": p2["id"]}, headers=h).status_code == 403
    assert client.post(f"/api/agent/tasks/{t2['id']}/complete", json={}, headers=h).status_code == 404
    assert client.post(f"/api/agent/tasks/{t1['id']}/complete", json={}, headers=h).status_code == 200
    # Focus sessions follow the task's scope.
    body = {"taskId": t1s["id"], "startedAt": 1761724800000, "endedAt": 1761727500000, "seconds": 60}
    assert client.post("/api/agent/focus-sessions", json=body, headers=h).status_code == 201
    assert client.post("/api/agent/focus-sessions", json={**body, "taskId": t2["id"]}, headers=h).status_code == 404
    # Delete + restore inside scope work; outside are 404.
    victim = client.post("/api/agent/tasks", json={"title": "v", "projectId": p1["id"]}, headers=h).json()
    assert client.request("DELETE", f"/api/agent/entities/tasks/{victim['id']}", headers=h).status_code == 200
    assert client.post(f"/api/agent/entities/tasks/{victim['id']}/restore", headers=h).status_code == 200
    assert client.request("DELETE", f"/api/agent/entities/tasks/{t2['id']}", headers=h).status_code == 404
    # Key metadata exposes the boundary; a bogus project is refused.
    listed = client.get("/api/agent-tokens", headers=auth(session)).json()["tokens"]
    assert any(t["name"] == "scoped-p1" and t["project_id"] == p1["id"] for t in listed)
    assert client.post("/api/agent-tokens", json={"name": "bad", "projectId": "ghost"},
                       headers=auth(session)).status_code == 422
    # A read+scoped key still cannot write inside its subtree.
    r2 = client.post("/api/agent-tokens", json={"name": "ro", "scope": "read", "projectId": p1["id"]},
                     headers=auth(session))
    assert client.post("/api/agent/tasks", json={"title": "x", "projectId": p1["id"]},
                       headers=auth(r2.json()["token"])).status_code == 403


def test_restore_integrity_rules(client):
    session, full, p1, s1, p2, t1, t1s, t2 = _setup_scoped(client)
    h = auth(full["token"])
    # Journal: no duplicate live entry for one date.
    client.put("/api/agent/journal/2026-10-29", json={"note": "first"}, headers=h)
    first_id = [e for e in client.get("/api/agent/entities/journal", headers=h).json()["entities"]
                if e["data"]["date"] == "2026-10-29"][0]["id"]
    client.request("DELETE", f"/api/agent/entities/journal/{first_id}", headers=h)
    client.put("/api/agent/journal/2026-10-29", json={"note": "second"}, headers=h)
    r = client.post(f"/api/agent/entities/journal/{first_id}/restore", headers=h)
    assert r.status_code == 409, r.text
    live = [e for e in client.get("/api/agent/entities/journal", headers=h).json()["entities"]
            if e["data"]["date"] == "2026-10-29" and not e["deleted"]]
    assert len(live) == 1
    # Orphans: a cascade-deleted task cannot be restored before its project.
    client.request("DELETE", f"/api/agent/entities/projects/{p1['id']}", headers=h)
    r = client.post(f"/api/agent/entities/tasks/{t1['id']}/restore", headers=h)
    assert r.status_code == 409 and "project" in r.json()["detail"]
    r = client.post(f"/api/agent/entities/projects/{p1['id']}/restore", headers=h)
    assert r.status_code == 200, r.text
    assert client.get(f"/api/agent/entities/tasks/{t1['id']}", headers=h).json()["deleted"] is False
    # Subtask before parent.
    parent = client.post("/api/agent/tasks", json={"title": "p", "projectId": p2["id"]}, headers=h).json()
    child = client.post("/api/agent/tasks", json={"title": "c", "parentId": parent["id"]}, headers=h).json()
    client.request("DELETE", f"/api/agent/entities/tasks/{parent['id']}", headers=h)
    assert client.post(f"/api/agent/entities/tasks/{child['id']}/restore", headers=h).status_code == 409
    assert client.post(f"/api/agent/entities/tasks/{parent['id']}/restore", headers=h).status_code == 200
    assert client.get(f"/api/agent/entities/tasks/{child['id']}", headers=h).json()["deleted"] is False
    # Ghost: a client-pushed empty tombstone has nothing to restore.
    pull = client.get("/api/changes?since=0", headers=auth(session)).json()
    ghost = "ghost-entity-1"
    r = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "tasks", "id": ghost, "base_rev": 0, "deleted": True, "data": {}}]})
    assert r.json()["results"][0]["status"] == "ok"
    assert client.post(f"/api/agent/entities/tasks/{ghost}/restore", headers=h).status_code == 409


def test_attachments_upload_download_delete_restore(client, monkeypatch, tmp_path):
    monkeypatch.setenv("SYNC_ATTACHMENT_MAX_FILE_MB", "1")
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    t = client.post("/api/agent/tasks", json={"title": "att task"}, headers=h).json()
    payload = b"hello attachment " * 100
    # Session token (the app) can upload; agent key can too.
    r = client.post(f"/api/attachments?task_id={t['id']}&filename=note.txt",
                    content=payload, headers={**auth(session), "Content-Type": "text/plain"})
    assert r.status_code == 201, r.text
    att = r.json()
    assert att["byteSize"] == len(payload) and att["name"] == "note.txt"
    assert len(att["sha256"]) == 64
    # Metadata syncs like any entity; bytes come from the content route.
    pull = client.get("/api/changes?since=0", headers=auth(session)).json()
    assert any(c["collection"] == "attachments" and c["id"] == att["id"] for c in pull["changes"])
    dl = client.get(f"/api/attachments/{att['id']}/content", headers=h)
    assert dl.status_code == 200 and dl.content == payload
    # Unknown task / oversized / empty are refused.
    assert client.post("/api/attachments?task_id=ghost&filename=x", content=b"x", headers=h).status_code == 422
    big = b"x" * (1024 * 1024 + 1)
    r_big = client.post(f"/api/attachments?task_id={t['id']}&filename=big", content=big, headers=h)
    assert r_big.status_code == 413
    # Machine-readable reason: per-file-size refusals need attention, unlike
    # storage-quota 413s which can heal when space frees.
    assert r_big.json()["detail"] == {"reason": "attachment_file_too_large", "max_file_mb": 1}
    assert client.post(f"/api/attachments?task_id={t['id']}&filename=e", content=b"", headers=h).status_code == 422
    # Delete tombstones the metadata, keeps the blob; restore recovers both.
    client.delete(f"/api/attachments/{att['id']}", headers=h)
    assert client.get(f"/api/attachments/{att['id']}/content", headers=h).status_code == 404
    ent = client.get(f"/api/agent/entities/attachments/{att['id']}", headers=h).json()
    assert ent["deleted"] is True and ent["data"]["sha256"] == att["sha256"]
    rr = client.post(f"/api/agent/entities/attachments/{att['id']}/restore", headers=h)
    assert rr.status_code == 200, rr.text
    dl2 = client.get(f"/api/attachments/{att['id']}/content", headers=h)
    assert dl2.status_code == 200 and dl2.content == payload


def test_attachments_scope_and_readonly(client):
    session, full, p1, s1, p2, t1, t1s, t2 = _setup_scoped(client)
    rkey = make_key(client, session, name="reader", scope="read")
    assert client.post(f"/api/attachments?task_id={t1['id']}&filename=x", content=b"x",
                       headers=auth(rkey["token"])).status_code == 403
    scoped = client.post("/api/agent-tokens", json={"name": "sp", "scope": "read-write", "projectId": p1["id"]},
                         headers=auth(session)).json()["token"]
    h = auth(scoped)
    ok = client.post(f"/api/attachments?task_id={t1s['id']}&filename=x", content=b"x", headers=h)
    assert ok.status_code == 201, ok.text
    assert client.post(f"/api/attachments?task_id={t2['id']}&filename=x", content=b"x", headers=h).status_code == 404
    assert client.get(f"/api/attachments/{ok.json()['id']}/content", headers=h).status_code == 200
    # Cross-user isolation: another account's key cannot see the attachment.
    session2 = register(client, username="someone-else")
    seed_inbox(client, session2)
    other = make_key(client, session2)
    assert client.get(f"/api/attachments/{ok.json()['id']}/content", headers=auth(other["token"])).status_code == 404


def test_scope_leaks_closed(client):
    session, full, p1, s1, p2, t1, t1s, t2 = _setup_scoped(client)
    fh = auth(full["token"])
    scoped = client.post("/api/agent-tokens", json={"name": "sp", "scope": "read-write", "projectId": p1["id"]},
                         headers=auth(session)).json()["token"]
    h = auth(scoped)
    # References across the boundary are refused, not leaked.
    assert client.post("/api/agent/tasks", json={"title": "x", "projectId": p1["id"], "parentId": t2["id"]}, headers=h).status_code == 404
    scoped_task = client.post("/api/agent/tasks", json={"title": "x", "projectId": p1["id"]}, headers=h).json()
    assert client.patch(f"/api/agent/tasks/{scoped_task['id']}", json={"blockedBy": [t2["id"]]}, headers=h).status_code == 404
    goal = client.post("/api/agent/goals", json={"title": "G"}, headers=fh).json()
    note = client.post("/api/agent/notes", json={"title": "N"}, headers=fh).json()
    assert client.post("/api/agent/tasks", json={"title": "x", "projectId": p1["id"], "goalId": goal["id"]}, headers=h).status_code == 403
    assert client.post("/api/agent/tasks", json={"title": "x", "projectId": p1["id"], "noteId": note["id"]}, headers=h).status_code == 403
    # Project visibility is the subtree only.
    names = {e["data"]["name"] for e in client.get("/api/agent/entities/projects", headers=h).json()["entities"]}
    assert names == {"P1", "S1"}
    assert client.get(f"/api/agent/entities/projects/{p2['id']}", headers=h).status_code == 404
    counts = client.get("/api/agent/collections", headers=h).json()["collections"]
    assert counts["projects"] == 2 and "habits" not in counts
    # Cross-boundary cascade delete is refused whole; nothing in B is touched.
    cross = client.post("/api/agent/tasks", json={"title": "cross child", "projectId": p2["id"], "parentId": t1["id"]}, headers=fh).json()
    dep = client.post("/api/agent/tasks", json={"title": "dep", "projectId": p2["id"]}, headers=fh).json()
    assert client.patch(f"/api/agent/tasks/{dep['id']}", json={"blockedBy": [t1["id"]]}, headers=fh).status_code == 200
    r = client.request("DELETE", f"/api/agent/entities/tasks/{t1['id']}", headers=h)
    assert r.status_code == 409, r.text
    assert client.get(f"/api/agent/entities/tasks/{cross['id']}", headers=fh).json()["deleted"] is False
    assert client.get(f"/api/agent/entities/tasks/{dep['id']}", headers=fh).json()["data"]["blockedBy"] == [t1["id"]]
    # Full-access delete is recursive now; restore brings the whole subtree back.
    mid = client.post("/api/agent/tasks", json={"title": "mid", "projectId": p2["id"], "parentId": t2["id"]}, headers=fh).json()
    leaf = client.post("/api/agent/tasks", json={"title": "leaf", "projectId": p2["id"], "parentId": mid["id"]}, headers=fh).json()
    r = client.request("DELETE", f"/api/agent/entities/tasks/{t2['id']}", headers=fh)
    assert set(r.json()["tombstoned"]) == {t2["id"], mid["id"], leaf["id"]}
    r = client.post(f"/api/agent/entities/tasks/{t2['id']}/restore", headers=fh)
    assert set(r.json()["ids"]) == {f"tasks:{t2['id']}", f"tasks:{mid['id']}", f"tasks:{leaf['id']}"}


def test_attachment_quota_counts_retained_blobs(client, monkeypatch):
    monkeypatch.setenv("SYNC_ATTACHMENT_QUOTA_MB", "1")
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    t = client.post("/api/agent/tasks", json={"title": "q"}, headers=h).json()
    blob = b"x" * (900 * 1024)
    r = client.post(f"/api/attachments?task_id={t['id']}&filename=a", content=blob, headers=h)
    assert r.status_code == 201
    client.delete(f"/api/attachments/{r.json()['id']}", headers=h)
    # Live bytes are 0, but the retained blob still occupies disk: refuse.
    r2 = client.post(f"/api/attachments?task_id={t['id']}&filename=b", content=blob, headers=h)
    assert r2.status_code == 413, r2.text
    assert r2.json()["detail"] == {"reason": "attachment_quota_exceeded", "quota_mb": 1}


def test_task_delete_cascades_attachments_and_restore_recovers(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    t = client.post("/api/agent/tasks", json={"title": "host"}, headers=h).json()
    att = client.post(f"/api/attachments?task_id={t['id']}&filename=f", content=b"data", headers=h).json()
    r = client.request("DELETE", f"/api/agent/entities/tasks/{t['id']}", headers=h)
    assert att["id"] in r.json()["tombstoned"]
    assert client.get(f"/api/attachments/{att['id']}/content", headers=h).status_code == 404
    rr = client.post(f"/api/agent/entities/tasks/{t['id']}/restore", headers=h)
    assert f"attachments:{att['id']}" in rr.json()["ids"]
    dl = client.get(f"/api/attachments/{att['id']}/content", headers=h)
    assert dl.status_code == 200 and dl.content == b"data"
    assert dl.headers["content-disposition"].startswith("attachment;")
    assert dl.headers["x-content-type-options"] == "nosniff"


def test_attachment_metadata_syncs_via_client_push(client):
    session = register(client)
    seed_inbox(client, session)
    r = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "attachments", "id": "a1", "base_rev": 0,
         "data": {"id": "a1", "taskId": "t1", "name": "f.txt", "mime": "text/plain", "byteSize": 3}}]})
    assert r.json()["results"][0]["status"] == "ok", r.text
    pull = client.get("/api/changes?since=0", headers=auth(session)).json()
    assert any(c["collection"] == "attachments" and c["id"] == "a1" for c in pull["changes"])


def test_automation_rules_roundtrip(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    got = client.get("/api/agent/settings/automation", headers=h).json()
    assert got["rules"] == {"rollover": False, "completeParent": False}
    r = client.put("/api/agent/settings/automation",
                   json={"rollover": True, "completeParent": True}, headers=h)
    assert r.status_code == 200, r.text
    # Partial update merges; unknown fields and wrong types rejected
    client.put("/api/agent/settings/automation", json={"rollover": False}, headers=h)
    got = client.get("/api/agent/settings/automation", headers=h).json()
    assert got["rules"] == {"rollover": False, "completeParent": True}
    assert client.put("/api/agent/settings/automation",
                      json={"evil": True}, headers=h).status_code == 422
    assert client.put("/api/agent/settings/automation",
                      json={"rollover": "yes"}, headers=h).status_code == 422
    # Generic collection read sees the singleton
    lst = client.get("/api/agent/entities/automationRules", headers=h).json()
    assert [i["id"] for i in lst["entities"]] == ["settings"]


def test_user_rules_crud_and_validation(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    r = client.post("/api/agent/user-rules",
                    json={"trigger": {"kind": "tag", "tag": "#gym"}, "title": "Log workout"}, headers=h)
    assert r.status_code == 201, r.text
    rid = r.json()["id"]
    assert r.json()["data"]["trigger"] == {"kind": "tag", "tag": "gym"}
    assert r.json()["data"]["lastFired"] is None
    bad = [
        {"trigger": {"kind": "nope"}, "title": "x"},
        {"trigger": {"kind": "tag"}, "title": "x"},
        {"trigger": {"kind": "weekly", "weekday": 7}, "title": "x"},
        {"trigger": {"kind": "weekly", "weekday": True}, "title": "x"},
        {"trigger": {"kind": "tag", "tag": "gym"}},
        {"trigger": {"kind": "tag", "tag": "gym"}, "title": "x", "lastFired": "not-a-date"},
        {"trigger": {"kind": "tag", "tag": "gym"}, "title": "x", "bogus": 1},
    ]
    for body in bad:
        assert client.post("/api/agent/user-rules", json=body, headers=h).status_code == 422, body
    # Patch to weekly + lastFired stamp
    r = client.patch(f"/api/agent/user-rules/{rid}",
                     json={"trigger": {"kind": "weekly", "weekday": 1},
                           "lastFired": "2026-10-26"}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["data"]["trigger"] == {"kind": "weekly", "weekday": 1}
    assert client.patch("/api/agent/user-rules/nope", json={"title": "x"}, headers=h).status_code == 404
    # Delete via the generic endpoint, restore brings it back
    client.delete(f"/api/agent/entities/userRules/{rid}", headers=h)
    lst = client.get("/api/agent/entities/userRules", headers=h).json()
    assert lst["entities"] == []
    client.post(f"/api/agent/entities/userRules/{rid}/restore", headers=h)
    lst = client.get("/api/agent/entities/userRules", headers=h).json()
    assert len(lst["entities"]) == 1
    # Client sync push accepts both collections
    push = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "automationRules", "id": "settings", "base_rev": 0,
         "data": {"rollover": True, "completeParent": False}}]})
    assert push.json()["results"][0]["status"] == "ok", push.text




def test_attachment_quota_uses_disk_not_client_metadata(client, monkeypatch):
    monkeypatch.setenv("SYNC_ATTACHMENT_QUOTA_MB", "1")
    session = register(client)
    seed_inbox(client, session)
    # A session client pushes metadata claiming 1 TB: it must NOT poison the
    # quota, because usage is measured from real blobs on disk.
    poison = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "attachments", "id": "fake1", "base_rev": 0,
         "data": {"id": "fake1", "taskId": "t1", "name": "f", "mime": "text/plain",
                  "byteSize": 10**12}}]})
    assert poison.json()["results"][0]["status"] == "ok"
    key = make_key(client, session)
    h = auth(key["token"])
    t = client.post("/api/agent/tasks", json={"title": "q"}, headers=h).json()
    blob = b"x" * (900 * 1024)
    r = client.post(f"/api/attachments?task_id={t['id']}&filename=a", content=blob, headers=h)
    assert r.status_code == 201, r.text  # 0.9 MB real < 1 MB cap despite the 1 TB claim
    # ...but real disk usage still caps: a second 900 KB file exceeds 1 MB.
    r2 = client.post(f"/api/attachments?task_id={t['id']}&filename=b", content=blob, headers=h)
    assert r2.status_code == 413, r2.text


def test_attachment_unsafe_ids_rejected(client):
    session = register(client)
    seed_inbox(client, session)
    h = auth(session)
    for bad in ("..", ".", "../x", "a/b", "a b", ".hidden"):
        r = client.post("/api/changes", headers=h, json={"changes": [
            {"collection": "attachments", "id": bad, "base_rev": 0,
             "data": {"id": bad, "taskId": "t1", "name": "f", "mime": "text/plain", "byteSize": 1}}]})
        assert r.json()["results"][0]["status"] == "invalid_id", bad
    assert client.get("/api/attachments/../content", headers=h).status_code in (404, 405)
    assert client.get("/api/attachments/%2E%2E/content", headers=h).status_code == 404
    # Legitimate ids still work
    ok = client.post("/api/changes", headers=h, json={"changes": [
        {"collection": "attachments", "id": "att-1_X.z", "base_rev": 0,
         "data": {"id": "att-1_X.z", "taskId": "t1", "name": "f", "mime": "text/plain", "byteSize": 1}}]})
    assert ok.json()["results"][0]["status"] == "ok"


def test_failed_upload_leaves_no_orphan_blob(client, monkeypatch):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    t = client.post("/api/agent/tasks", json={"title": "q"}, headers=h).json()
    import app.agent as agent_mod
    from app.auth import hash_token
    uid = get_conn().execute("SELECT user_id FROM tokens WHERE token = ?", (hash_token(session),)).fetchone()["user_id"]
    def boom(*a, **k):
        raise OSError("simulated disk failure")
    monkeypatch.setattr(agent_mod.os, "replace", boom)
    # TestClient re-raises handler exceptions; the endpoint's cleanup must
    # still have run before the error propagated.
    with pytest.raises(OSError):
        client.post(f"/api/attachments?task_id={t['id']}&filename=a", content=b"data", headers=h)
    # No entity, no blob, no tmp file left behind
    lst = client.get("/api/agent/entities/attachments", headers=h).json()
    assert lst["entities"] == []
    blob_dir = os.path.join(agent_mod._BLOB_DIR, str(uid))
    leftovers = os.listdir(blob_dir) if os.path.isdir(blob_dir) else []
    assert leftovers == [], leftovers


def test_scoped_key_project_mutations(client):
    session = register(client)
    seed_inbox(client, session)
    h = auth(session)
    root = client.post("/api/agent/projects", json={"name": "Root"},
                       headers=auth(make_key(client, session)["token"])).json()
    child = client.post("/api/agent/projects", json={"name": "Child", "parentId": root["id"]},
                        headers=auth(make_key(client, session)["token"])).json()
    other = client.post("/api/agent/projects", json={"name": "Other"},
                        headers=auth(make_key(client, session)["token"])).json()
    scoped = client.post("/api/agent-tokens",
                         json={"name": "sp", "scope": "read-write", "projectId": root["id"]},
                         headers=h).json()
    s = auth(scoped["token"])

    # Create inside the subtree: under the root and under a descendant
    r = client.post("/api/agent/projects", json={"name": "Sub", "parentId": root["id"]}, headers=s)
    assert r.status_code == 201, r.text
    sub = r.json()
    r = client.post("/api/agent/projects", json={"name": "SubSub", "parentId": child["id"]}, headers=s)
    assert r.status_code == 201, r.text
    # Create at top level or under an out-of-scope parent: refused, no oracle
    assert client.post("/api/agent/projects", json={"name": "Top"}, headers=s).status_code == 403
    r = client.post("/api/agent/projects", json={"name": "Sneak", "parentId": other["id"]}, headers=s)
    assert r.status_code == 422 and "no such project" in r.json()["detail"]

    # Patch a descendant: rename and recolor work
    r = client.patch(f"/api/agent/projects/{sub['id']}", json={"name": "Renamed", "color": "#123abc"}, headers=s)
    assert r.status_code == 200 and r.json()["project"]["name"] == "Renamed", r.text
    # Move within the subtree works (under Child)
    r = client.patch(f"/api/agent/projects/{sub['id']}", json={"parentId": child["id"]}, headers=s)
    assert r.status_code == 200 and r.json()["project"]["parentId"] == child["id"], r.text
    # The key's root project is read-only (shared context)
    assert client.patch(f"/api/agent/projects/{root['id']}", json={"name": "Nope"}, headers=s).status_code == 403
    # Out-of-scope project: 404, no oracle
    assert client.patch(f"/api/agent/projects/{other['id']}", json={"name": "Nope"}, headers=s).status_code == 404
    # Moves out of scope are refused
    r = client.patch(f"/api/agent/projects/{sub['id']}", json={"parentId": other["id"]}, headers=s)
    assert r.status_code == 422 and "no such project" in r.json()["detail"]
    r = client.patch(f"/api/agent/projects/{sub['id']}", json={"parentId": None}, headers=s)
    assert r.status_code == 422 and "out of this key's scope" in r.json()["detail"]
    # Cycle protection still applies inside the subtree
    r = client.patch(f"/api/agent/projects/{child['id']}", json={"parentId": sub["id"]}, headers=s)
    assert r.status_code == 422 and "cycle" in r.json()["detail"]
    # Deletion policy unchanged: scoped keys still cannot delete projects
    assert client.delete(f"/api/agent/entities/projects/{sub['id']}", headers=s).status_code == 403


def test_upload_with_client_id_is_idempotent(client):
    session = register(client)
    seed_inbox(client, session)
    h = auth(session)
    t = client.post("/api/agent/tasks", json={"title": "host"},
                    headers=auth(make_key(client, session)["token"])).json()
    # App-style upload: session token, client-chosen id (as repo.addAttachment sends)
    r = client.post(f"/api/attachments?task_id={t['id']}&filename=note.txt&id=att-app-1",
                    content=b"hello", headers=h)
    assert r.status_code == 201, r.text
    assert r.json()["id"] == "att-app-1"
    assert r.json()["blobOnServer"] is True
    assert r.json()["rev"] >= 1
    # Retry of the same id with the same bytes returns the entity, no duplicate
    r2 = client.post(f"/api/attachments?task_id={t['id']}&filename=note.txt&id=att-app-1",
                     content=b"hello", headers=h)
    assert r2.status_code == 201, r2.text
    assert r2.json()["id"] == "att-app-1"
    lst = client.get("/api/changes?since=0", headers=h).json()
    atts = [c for c in lst["changes"] if c["collection"] == "attachments"]
    assert len(atts) == 1
    # Same id, different bytes: conflict
    r3 = client.post(f"/api/attachments?task_id={t['id']}&filename=note.txt&id=att-app-1",
                     content=b"different", headers=h)
    assert r3.status_code == 409
    # Unsafe client id rejected
    r4 = client.post(f"/api/attachments?task_id={t['id']}&filename=x&id=..",
                     content=b"z", headers=h)
    assert r4.status_code == 422
    # Download works with the app's session token (dual auth)
    dl = client.get("/api/attachments/att-app-1/content", headers=h)
    assert dl.status_code == 200 and dl.content == b"hello"


def test_metadata_push_then_blob_upload_completes_row(client):
    """The reviewer's race: sync pushes metadata first, blob upload follows."""
    session = register(client)
    seed_inbox(client, session)
    h = auth(session)
    key = make_key(client, session)
    t = client.post("/api/agent/tasks", json={"title": "host"}, headers=auth(key["token"])).json()
    # 1. Metadata rides the JSON sync first (no sha256, no blob)
    r = client.post("/api/changes", headers=h, json={"changes": [
        {"collection": "attachments", "id": "att-race", "base_rev": 0,
         "data": {"id": "att-race", "taskId": t["id"], "name": "n.txt",
                  "mime": "text/plain", "byteSize": 5, "blobOnServer": True}}]})
    assert r.json()["results"][0]["status"] == "ok"
    # Server grounds blobOnServer: no file on disk, so the claim is rewritten
    pull = client.get("/api/changes?since=0", headers=h).json()
    row = [c for c in pull["changes"] if c["collection"] == "attachments"][0]
    assert row["data"]["blobOnServer"] is False
    assert client.get("/api/attachments/att-race/content", headers=h).status_code == 404
    # 2. The blob upload with the same id completes the row instead of 409
    r2 = client.post(f"/api/attachments?task_id={t['id']}&filename=n.txt&id=att-race",
                     content=b"hello", headers=h)
    assert r2.status_code == 201, r2.text
    assert r2.json()["sha256"] == hashlib.sha256(b"hello").hexdigest()
    assert r2.json()["blobOnServer"] is True
    dl = client.get("/api/attachments/att-race/content", headers=h)
    assert dl.status_code == 200 and dl.content == b"hello"
    # 3. Same id bound to a DIFFERENT task still conflicts
    t2 = client.post("/api/agent/tasks", json={"title": "other"}, headers=auth(key["token"])).json()
    client.post("/api/changes", headers=h, json={"changes": [
        {"collection": "attachments", "id": "att-race2", "base_rev": 0,
         "data": {"id": "att-race2", "taskId": t2["id"], "name": "x", "mime": "text/plain", "byteSize": 1}}]})
    r3 = client.post(f"/api/attachments?task_id={t['id']}&filename=x&id=att-race2",
                     content=b"z", headers=h)
    assert r3.status_code == 409


def test_quota_covers_metadata_completion_path(client, monkeypatch):
    """Round-7 defect: the metadata-completion branch must enforce quota too."""
    monkeypatch.setenv("SYNC_ATTACHMENT_QUOTA_MB", "1")
    session = register(client)
    seed_inbox(client, session)
    h = auth(session)
    key = make_key(client, session)
    t = client.post("/api/agent/tasks", json={"title": "host"}, headers=auth(key["token"])).json()
    blob = b"x" * (900 * 1024)
    # Free-form metadata rows first, then blob uploads against them.
    for i in range(3):
        r = client.post("/api/changes", headers=h, json={"changes": [
            {"collection": "attachments", "id": f"m{i}", "base_rev": 0,
             "data": {"id": f"m{i}", "taskId": t["id"], "name": "f", "mime": "text/plain", "byteSize": 1}}]})
        assert r.json()["results"][0]["status"] == "ok"
    r1 = client.post(f"/api/attachments?task_id={t['id']}&filename=f&id=m0", content=blob, headers=h)
    assert r1.status_code == 201, r1.text
    r2 = client.post(f"/api/attachments?task_id={t['id']}&filename=f&id=m1", content=blob, headers=h)
    assert r2.status_code == 413, r2.text  # cap hit on the completion path
    assert client.get("/api/attachments/m1/content", headers=h).status_code == 404
    # Fresh-upload path still enforces as before
    r3 = client.post(f"/api/attachments?task_id={t['id']}&filename=f&id=m2", content=blob, headers=h)
    assert r3.status_code == 413, r3.text


def test_device_settings_roundtrip_and_validation(client):
    session = register(client)
    seed_inbox(client, session)
    # The device mirrors its local prefs into a deviceSettings entity.
    device_id = "dev-" + uuid.uuid4().hex[:12]
    r = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "deviceSettings", "id": device_id, "base_rev": 0, "deleted": False,
         "data": {"id": device_id, "label": "Chrome on Linux", "updatedAt": "2026-10-29T13:00:00Z",
                  "theme": "dark", "style": "paper", "font": "inter",
                  "wallpaper": {"id": "aurora", "intensity": 20},
                  "remindersEnabled": True, "journalPromptEnabled": False}}]})
    assert r.json()["results"][0]["status"] == "ok", r.text

    key = make_key(client, session)
    h = auth(key["token"])
    got = client.get("/api/agent/devices", headers=h).json()
    assert [d["deviceId"] for d in got["devices"]] == [device_id]
    assert got["devices"][0]["label"] == "Chrome on Linux"
    assert got["devices"][0]["settings"]["theme"] == "dark"

    got = client.get(f"/api/agent/devices/{device_id}/settings", headers=h).json()
    assert got["settings"]["font"] == "inter"

    # Partial update merges and stamps updatedAt.
    r = client.put(f"/api/agent/devices/{device_id}/settings",
                   json={"theme": "light", "wallpaper": {"id": "blue", "intensity": 35}}, headers=h)
    assert r.status_code == 200, r.text
    got = client.get(f"/api/agent/devices/{device_id}/settings", headers=h).json()
    assert got["settings"]["theme"] == "light"
    assert got["settings"]["font"] == "inter"
    assert got["settings"]["wallpaper"] == {"id": "blue", "intensity": 35}
    assert got["settings"]["remindersEnabled"] is True
    assert got["label"] == "Chrome on Linux"
    assert got["updatedAt"] != "2026-10-29T13:00:00Z"

    # The change rides normal sync back to the device.
    pull = client.get("/api/changes?since=0", headers=auth(session)).json()
    row = next(c for c in pull["changes"] if c["collection"] == "deviceSettings")
    assert row["data"]["theme"] == "light"

    # Validation matrix.
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"theme": "blue"}, headers=h).status_code == 422
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"style": "shiny"}, headers=h).status_code == 422
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"font": "comic-sans"}, headers=h).status_code == 422
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"wallpaper": {"id": "mars", "intensity": 20}}, headers=h).status_code == 422
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"wallpaper": {"id": "none", "intensity": 36}}, headers=h).status_code == 422
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"wallpaper": {"id": "none", "intensity": True}}, headers=h).status_code == 422
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"remindersEnabled": "yes"}, headers=h).status_code == 422
    r = client.put(f"/api/agent/devices/{device_id}/settings",
                   json={"image": "data:image/jpeg;base64,xx"}, headers=h)
    assert r.status_code == 422 and "stays on the device" in r.json()["detail"]
    assert client.get("/api/agent/devices/nope!!!/settings", headers=h).status_code == 422
    assert client.get("/api/agent/devices/dev-unknown00/settings", headers=h).status_code == 404

    # Read-only keys cannot mutate.
    ro = make_key(client, session, name="reader", scope="read")
    assert client.put(f"/api/agent/devices/{device_id}/settings",
                      json={"theme": "dark"}, headers=auth(ro["token"])).status_code == 403
    assert client.get("/api/agent/devices", headers=auth(ro["token"])).status_code == 200


def test_device_settings_hidden_from_project_scoped_keys(client):
    session = register(client)
    seed_inbox(client, session)
    r = client.post("/api/agent-tokens", json={"name": "scoped", "scope": "read-write", "projectId": "inbox"},
                    headers=auth(session))
    assert r.status_code == 201, r.text
    h = auth(r.json()["token"])
    assert client.get("/api/agent/devices", headers=h).status_code == 403
    assert client.get("/api/agent/devices/dev-abcdefgh/settings", headers=h).status_code == 403
    assert client.put("/api/agent/devices/dev-abcdefgh/settings", json={"theme": "dark"}, headers=h).status_code == 403


def test_device_settings_put_requires_live_device_and_nonempty_patch(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    device_id = "dev-" + uuid.uuid4().hex[:12]
    # Unknown device: 404, and no phantom row is created.
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"theme": "dark"}, headers=h).status_code == 404
    assert client.get("/api/agent/devices", headers=h).json()["devices"] == []
    # Malformed ids: 422 on PUT too, never a row.
    for bad in ("short", "x" * 65, "ab cd efgh"):
        assert client.put(f"/api/agent/devices/{bad}/settings", json={"theme": "dark"}, headers=h).status_code == 422
    assert client.get("/api/agent/devices", headers=h).json()["devices"] == []

    # Register the device through the sync push path.
    r = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "deviceSettings", "id": device_id, "base_rev": 0, "deleted": False,
         "data": {"id": device_id, "label": "Phone", "theme": "dark", "font": "plex"}}]})
    assert r.json()["results"][0]["status"] == "ok", r.text

    # Empty patch: 422, no timestamp bump.
    before = client.get(f"/api/agent/devices/{device_id}/settings", headers=h).json()
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={}, headers=h).status_code == 422
    after = client.get(f"/api/agent/devices/{device_id}/settings", headers=h).json()
    assert after["updatedAt"] == before["updatedAt"]

    # Soft-delete the device row (generic agent delete), then PUT: 404, no
    # revival, and the tombstone keeps its payload.
    lst = client.get("/api/agent/entities/deviceSettings", headers=h).json()
    assert [i["id"] for i in lst["entities"]] == [device_id]
    r = client.delete(f"/api/agent/entities/deviceSettings/{device_id}", headers=h)
    assert r.status_code in (200, 204), r.text
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"font": "mono"}, headers=h).status_code == 404
    tomb = client.get(f"/api/agent/entities/deviceSettings/{device_id}?include_deleted=true", headers=h)
    if tomb.status_code == 200:
        data = tomb.json().get("data") or tomb.json().get("entity", {}).get("data") or {}
        assert data.get("label") == "Phone"


def test_device_settings_delete_is_sticky_until_explicit_restore(client):
    # Contract: deleting a device's settings row is a deliberate soft delete.
    # The device cannot re-register by re-pushing - its pushes conflict
    # (server keeps the tombstone) until an explicit restore brings the row
    # back with its payload intact.
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    device_id = "dev-" + uuid.uuid4().hex[:12]
    payload = {"id": device_id, "label": "Pixel", "theme": "terminal", "font": "plex",
               "remindersEnabled": True}
    r = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "deviceSettings", "id": device_id, "base_rev": 0, "deleted": False,
         "data": payload}]})
    assert r.json()["results"][0]["status"] == "ok", r.text

    # Agent deletes the row: soft delete, payload retained on the tombstone.
    assert client.delete(f"/api/agent/entities/deviceSettings/{device_id}", headers=h).status_code == 200
    ent = client.get(f"/api/agent/entities/deviceSettings/{device_id}", headers=h).json()
    assert ent["deleted"] is True and ent["data"]["label"] == "Pixel"

    # The device re-registers (fresh install-style push, base_rev 0): conflict,
    # server wins - the tombstone and its payload survive, no revival.
    for _ in range(2):
        r = client.post("/api/changes", headers=auth(session), json={"changes": [
            {"collection": "deviceSettings", "id": device_id, "base_rev": 0, "deleted": False,
             "data": payload}]})
        assert r.json()["results"][0]["status"] == "conflict", r.text
        ent = client.get(f"/api/agent/entities/deviceSettings/{device_id}", headers=h).json()
        assert ent["deleted"] is True and ent["data"]["label"] == "Pixel"
    # And the PUT route still refuses the tombstoned device.
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"theme": "dark"}, headers=h).status_code == 404

    # Explicit restore revives the row with its payload, and PUT works again.
    assert client.post(f"/api/agent/entities/deviceSettings/{device_id}/restore", headers=h).status_code == 200
    ent = client.get(f"/api/agent/entities/deviceSettings/{device_id}", headers=h).json()
    assert ent["deleted"] is False and ent["data"]["theme"] == "terminal"
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"theme": "dark"}, headers=h).status_code == 200


def test_device_settings_view_normalizes_malformed_own_client_rows(client):
    # The owner's own client can push any shape through sync (trusted, like
    # every collection). The device-listing views normalize what they relay:
    # invalid values are omitted and labels bounded - the stored row is not
    # rewritten.
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    device_id = "dev-" + uuid.uuid4().hex[:12]
    r = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "deviceSettings", "id": device_id, "base_rev": 0, "deleted": False,
         "data": {"id": device_id, "label": "x" * 500, "theme": ["dark"], "font": "plex",
                  "wallpaper": {"id": "mars", "intensity": 99},
                  "remindersEnabled": "yes", "journalPromptEnabled": True}}]})
    assert r.json()["results"][0]["status"] == "ok", r.text

    got = client.get("/api/agent/devices", headers=h).json()["devices"][0]
    assert got["label"] == "x" * 120
    assert got["settings"] == {"font": "plex", "journalPromptEnabled": True}
    one = client.get(f"/api/agent/devices/{device_id}/settings", headers=h).json()
    assert one["label"] == "x" * 120
    assert one["settings"] == {"font": "plex", "journalPromptEnabled": True}
    # Non-string label: omitted, never relayed raw.
    pull = client.get("/api/changes?since=0", headers=auth(session)).json()
    rev = [c for c in pull["changes"] if c["id"] == device_id][0]["rev"]
    r = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "deviceSettings", "id": device_id, "base_rev": rev, "deleted": False,
         "data": {"id": device_id, "label": {"ua": "x"}, "font": "geist"}}]})
    assert r.json()["results"][0]["status"] == "ok", r.text
    one = client.get(f"/api/agent/devices/{device_id}/settings", headers=h).json()
    assert one["label"] is None and one["settings"] == {"font": "geist"}


def test_device_settings_accept_new_designprompts_styles(client):
    session = register(client)
    seed_inbox(client, session)
    key = make_key(client, session)
    h = auth(key["token"])
    device_id = "dev-" + uuid.uuid4().hex[:12]
    r = client.post("/api/changes", headers=auth(session), json={"changes": [
        {"collection": "deviceSettings", "id": device_id, "base_rev": 0, "deleted": False,
         "data": {"id": device_id, "label": "Chrome on Linux"}}]})
    assert r.json()["results"][0]["status"] == "ok", r.text
    for style in ("modern-dark", "playful-geometric", "cyberpunk", "luxury",
                  "professional", "retro", "sketch", "monochrome"):
        r = client.put(f"/api/agent/devices/{device_id}/settings", json={"style": style}, headers=h)
        assert r.status_code == 200, (style, r.text)
        assert r.json()["settings"]["style"] == style
    assert client.put(f"/api/agent/devices/{device_id}/settings", json={"style": "vaporwave"}, headers=h).status_code == 422
