"""Restore-rollback CHARACTERIZATION tests: they document what the server
does today when a database is restored from an older backup, so the
restore-reconciliation design can be evaluated against evidence. None of
these behaviors is claimed to be desirable; when the designed
reconciliation lands, these tests should be replaced by its contract.

Background: the per-user revision counter is the sync cursor. Clients
assume it is monotonic for the life of the account. A restore moves it
backward and rev numbers are reused for different entities.
"""

import os
import shutil
import sqlite3
import threading
import uuid

import pytest
from fastapi.testclient import TestClient

from app import db as dbmod
from app.main import app

# Isolation: this module simulates a server restore by replacing the live
# DB file, so it must never touch the shared default DB other test modules
# use. Point dbmod at a private temp file for the duration of the module.
import pytest as _pytest


@_pytest.fixture(scope="module", autouse=True)
def _isolated_db(tmp_path_factory):
    global BACKUP
    orig_path = dbmod.DB_PATH
    tmp = tmp_path_factory.mktemp("restore-char")
    dbmod.DB_PATH = str(tmp / "restore.db")
    BACKUP = dbmod.DB_PATH + ".characterization-backup"
    # Endpoint code runs on anyio pool threads that persist ACROSS test
    # modules and cache their connection in dbmod's thread-local. A thread
    # that served an earlier module would otherwise keep writing to the
    # shared default DB while this module snapshots and restores the tmp
    # file. Swap the thread-local at module entry so every thread opens a
    # fresh connection to the tmp file, create the schema deterministically
    # from this thread, and swap again on exit for the modules that follow.
    dbmod._local = threading.local()
    dbmod.get_conn().execute("SELECT 1")
    yield
    dbmod.DB_PATH = orig_path
    dbmod._local = threading.local()


def _register(client):
    username = f"rb-{uuid.uuid4().hex[:8]}"
    r = client.post("/api/register", json={"username": username, "password": "correct horse battery staple"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['token']}"}


def _push(client, headers, entity_id, title, base_rev=0):
    r = client.post("/api/changes", headers=headers, json={
        "changes": [{"collection": "tasks", "id": entity_id, "base_rev": base_rev,
                     "deleted": False, "data": {"id": entity_id, "title": title}}]})
    assert r.status_code == 200, r.text
    return r.json()["results"][0]


def _checkpoint_and_snapshot():
    """Online-backup the live DB (a consistent snapshot, WAL included)."""
    src = sqlite3.connect(dbmod.DB_PATH)
    src.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    dst = sqlite3.connect(BACKUP)
    src.backup(dst)
    dst.close()
    src.close()


def _restore_snapshot():
    """Simulate a server restore: replace the live DB with the older
    snapshot. A fresh TestClient afterwards reconnects to the restored
    file, exactly like a restarted server process would."""
    shutil.copyfile(BACKUP, dbmod.DB_PATH)
    for suf in ("-wal", "-shm"):
        p = dbmod.DB_PATH + suf
        if os.path.exists(p):
            os.remove(p)
    # A real restore is followed by a server restart: every connection is
    # new. TestClient requests run on anyio pool threads that OUTLIVE the
    # client and keep their thread-local connection to the pre-restore
    # file (and its deleted WAL), which poisons later requests. Swapping
    # the module's thread-local makes every thread open a fresh connection
    # to the restored file, like the restarted process would.
    dbmod._local = threading.local()


@pytest.fixture()
def cleanup():
    yield
    if os.path.exists(BACKUP):
        os.remove(BACKUP)


def test_pull_since_beyond_counter_is_silently_accepted(cleanup):
    """A client whose cursor is ahead of the restored counter gets a
    healthy-looking empty page - no error, no flag. (The client then
    adopts the lower counter as its cursor; see the app-side
    characterization test.)"""
    with TestClient(app) as client:
        h = _register(client)
        _push(client, h, "t1", "one")
        _push(client, h, "t2", "two")
        r = client.get("/api/changes?since=99", headers=h)
        assert r.status_code == 200  # today: silent acceptance, no signal
        assert r.json() == {"rev": 2, "changes": []}


def test_rev_numbers_are_reused_across_a_restore(cleanup):
    with TestClient(app) as client:
        h = _register(client)
        assert _push(client, h, "t1", "one")["rev"] == 1
        assert _push(client, h, "t2", "two")["rev"] == 2
        _checkpoint_and_snapshot()
        assert _push(client, h, "t3", "three")["rev"] == 3
        assert _push(client, h, "t4", "four")["rev"] == 4
    _restore_snapshot()
    with TestClient(app) as client:
        # Post-restore writes restart the counter: rev 3 now names a
        # DIFFERENT entity than it did before the restore.
        assert _push(client, h, "t-new", "new device task")["rev"] == 3
        body = client.get("/api/changes?since=0", headers=h).json()
        ids = {c["id"] for c in body["changes"]}
        assert ids == {"t1", "t2", "t-new"}  # t3/t4 vanished with the rollback


def test_counter_caught_up_after_restore_is_indistinguishable(cleanup):
    """Detection via 'since > counter' only works while the restored
    counter is below the client cursor. Once post-restore writes catch
    the counter up to (or past) the cursor, the API answers are
    identical in shape to a healthy server's - nothing signals the
    rollback."""
    with TestClient(app) as client:
        h = _register(client)
        _push(client, h, "t1", "one")
        _push(client, h, "t2", "two")
        _checkpoint_and_snapshot()
        _push(client, h, "t3", "three")
        _push(client, h, "t4", "four")  # counter 4 == future client cursor
        healthy = client.get("/api/changes?since=4", headers=h).json()
    _restore_snapshot()
    with TestClient(app) as client:
        _push(client, h, "n1", "post-restore one")  # rev 3, new timeline
        _push(client, h, "n2", "post-restore two")  # rev 4: counter caught up
        caught_up = client.get("/api/changes?since=4", headers=h).json()
        assert caught_up == healthy  # {"rev": 4, "changes": []} - indistinguishable
        # Counter past the cursor: the next page looks like ordinary new work.
        _push(client, h, "n3", "post-restore three")  # rev 5
        ahead = client.get("/api/changes?since=4", headers=h).json()
        assert ahead["rev"] == 5 and [c["id"] for c in ahead["changes"]] == ["n3"]


def test_same_generation_restore_presents_identical_handshake(cleanup):
    """A same-generation restore (the backup IS this database's own
    history) carries no distinguishing marker: no epoch, no generation
    field, identical responses. Generation-id detection cannot fire
    without a documented restore-time epoch rotation."""
    with TestClient(app) as client:
        h = _register(client)
        _push(client, h, "t1", "one")
        _push(client, h, "t2", "two")
        _checkpoint_and_snapshot()
        before = client.get("/api/changes?since=0", headers=h).json()
    _restore_snapshot()
    with TestClient(app) as client:
        after = client.get("/api/changes?since=0", headers=h).json()
        assert after == before  # nothing in the protocol tells them apart


def test_future_base_rev_is_a_plain_conflict_today(cleanup):
    """After a restore, a client can hold base_rev values ABOVE the
    server's current rev for the same entity - impossible within one
    timeline, so it is a reliable per-entity collision signal. Today the
    push answers a generic conflict, indistinguishable from a normal
    concurrent edit."""
    with TestClient(app) as client:
        h = _register(client)
        assert _push(client, h, "t1", "one")["rev"] == 1
        _push(client, h, "t2", "two")
        _checkpoint_and_snapshot()
        _push(client, h, "t3", "three")
        _push(client, h, "t4", "four")  # client's t1 edit would get base_rev up to 4
    _restore_snapshot()
    with TestClient(app) as client:
        # t1 is untouched post-restore: server rev 1, client base_rev 4.
        result = _push(client, h, "t1", "client newer edit", base_rev=4)
        assert result["status"] == "conflict"  # today: no anomaly signal
        assert set(result.keys()) == {"collection", "id", "status", "current"}
