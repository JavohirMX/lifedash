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
