"""Restore-rollback CHARACTERIZATION tests: they document what the server
does today when a database is restored from an older backup, so the
restore-reconciliation design can be evaluated against evidence. None of
these behaviors is claimed to be desirable; when the designed
reconciliation lands, these tests should be replaced by its contract.

Background: the per-user revision counter is the sync cursor. Clients
assume it is monotonic for the life of the account. A restore moves it
backward and rev numbers are reused for different entities.

Each restore test runs a REAL uvicorn subprocess, snapshots the live
database with SQLite's online backup, stops the server, replaces the
database file with the snapshot, and boots a fresh server - the same
sequence the recovery docs prescribe (restore into a stopped server,
then restart). Earlier in-process versions of these tests raced the
TestClient/anyio thread pool, whose workers outlive a client and keep
connections to the pre-restore file; the subprocess boundary makes the
restart semantics exact and the outcome deterministic.
"""

import contextlib
import json
import os
import shutil
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request
import uuid

SERVER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@contextlib.contextmanager
def _server(db_path):
    env = {**os.environ, "SYNC_DB": str(db_path), "SYNC_OPEN_REGISTRATION": "1"}
    env.pop("SYNC_TRUSTED_PROXY_HOPS", None)
    env.pop("SYNC_TRUSTED_PROXY_IPS", None)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        port = listener.getsockname()[1]
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--fd", str(listener.fileno()),
             "--no-proxy-headers"],
            cwd=SERVER, env=env, pass_fds=(listener.fileno(),),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        try:
            deadline = time.monotonic() + 20
            while True:
                if proc.poll() is not None:
                    raise RuntimeError("uvicorn exited before becoming healthy")
                try:
                    with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=2) as r:
                        if r.status == 200:
                            break
                except OSError:
                    if time.monotonic() >= deadline:
                        raise
                    time.sleep(0.1)
            yield f"http://127.0.0.1:{port}"
        finally:
            proc.terminate()
            proc.wait(timeout=10)


def _call(base, method, path, body=None, headers=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(
        base + path, data=data, method=method,
        headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=5) as r:
        return r.status, json.loads(r.read() or b"null")


def _register(base):
    username = f"rb-{uuid.uuid4().hex[:8]}"
    status, body = _call(base, "POST", "/api/register",
                         {"username": username, "password": "correct horse battery staple"})
    assert status == 200, body
    return {"Authorization": f"Bearer {body['token']}"}


def _push(base, headers, entity_id, title, base_rev=0):
    status, body = _call(base, "POST", "/api/changes", {
        "changes": [{"collection": "tasks", "id": entity_id, "base_rev": base_rev,
                     "deleted": False, "data": {"id": entity_id, "title": title}}]}, headers)
    assert status == 200, body
    return body["results"][0]


def _changes(base, headers, since):
    status, body = _call(base, "GET", f"/api/changes?since={since}", headers=headers)
    assert status == 200, body
    return body


def _snapshot(db_path, backup_path):
    """Online-backup the live DB (a consistent snapshot, WAL included)."""
    src = sqlite3.connect(str(db_path))
    src.execute("PRAGMA wal_checkpoint(TRUNCATE)")
    dst = sqlite3.connect(str(backup_path))
    src.backup(dst)
    dst.close()
    src.close()


def _restore(db_path, backup_path):
    """Replace the stopped server's database with the older snapshot and
    drop sidecars, exactly like the documented restore-into-stopped-server
    flow (no WAL/SHM beside the restored file)."""
    shutil.copyfile(str(backup_path), str(db_path))
    for suf in ("-wal", "-shm"):
        p = str(db_path) + suf
        if os.path.exists(p):
            os.remove(p)


def test_pull_since_beyond_counter_is_silently_accepted(tmp_path):
    """A client whose cursor is ahead of the (restored) counter gets a
    healthy-looking empty page - no error, no flag. (The client then
    adopts the lower counter as its cursor; see the app-side
    characterization test.)"""
    db = tmp_path / "restore.db"
    with _server(db) as base:
        h = _register(base)
        _push(base, h, "t1", "one")
        _push(base, h, "t2", "two")
        body = _changes(base, h, 99)
        assert body == {"rev": 2, "changes": []}  # today: silent acceptance


def test_rev_numbers_are_reused_across_a_restore(tmp_path):
    db = tmp_path / "restore.db"
    backup = tmp_path / "backup.db"
    with _server(db) as base:
        h = _register(base)
        assert _push(base, h, "t1", "one")["rev"] == 1
        assert _push(base, h, "t2", "two")["rev"] == 2
        _snapshot(db, backup)
        assert _push(base, h, "t3", "three")["rev"] == 3
        assert _push(base, h, "t4", "four")["rev"] == 4
    _restore(db, backup)
    with _server(db) as base:
        # Post-restore writes restart the counter: rev 3 now names a
        # DIFFERENT entity than it did before the restore.
        assert _push(base, h, "t-new", "new device task")["rev"] == 3
        body = _changes(base, h, 0)
        ids = {c["id"] for c in body["changes"]}
        assert ids == {"t1", "t2", "t-new"}  # t3/t4 vanished with the rollback


def test_counter_caught_up_after_restore_is_indistinguishable(tmp_path):
    """Detection via 'since > counter' only works while the restored
    counter is below the client cursor. Once post-restore writes catch
    the counter up to (or past) the cursor, the API answers are
    identical in shape to a healthy server's - nothing signals the
    rollback."""
    db = tmp_path / "restore.db"
    backup = tmp_path / "backup.db"
    with _server(db) as base:
        h = _register(base)
        _push(base, h, "t1", "one")
        _push(base, h, "t2", "two")
        _snapshot(db, backup)
        _push(base, h, "t3", "three")
        _push(base, h, "t4", "four")  # counter 4 == future client cursor
        healthy = _changes(base, h, 4)
    _restore(db, backup)
    with _server(db) as base:
        _push(base, h, "n1", "post-restore one")  # rev 3, new timeline
        _push(base, h, "n2", "post-restore two")  # rev 4: counter caught up
        caught_up = _changes(base, h, 4)
        assert caught_up == healthy  # {"rev": 4, "changes": []} - indistinguishable
        # Counter past the cursor: the next page looks like ordinary new work.
        _push(base, h, "n3", "post-restore three")  # rev 5
        ahead = _changes(base, h, 4)
        assert ahead["rev"] == 5 and [c["id"] for c in ahead["changes"]] == ["n3"]


def test_same_generation_restore_presents_identical_handshake(tmp_path):
    """A same-generation restore (the backup IS this database's own
    history) carries no distinguishing marker: no epoch, no generation
    field, identical responses. Generation-id detection cannot fire
    without a documented restore-time epoch rotation."""
    db = tmp_path / "restore.db"
    backup = tmp_path / "backup.db"
    with _server(db) as base:
        h = _register(base)
        _push(base, h, "t1", "one")
        _push(base, h, "t2", "two")
        _snapshot(db, backup)
        before = _changes(base, h, 0)
    _restore(db, backup)
    with _server(db) as base:
        after = _changes(base, h, 0)
        assert after == before  # nothing in the protocol tells them apart


def test_future_base_rev_is_a_plain_conflict_today(tmp_path):
    """After a restore, a client can hold base_rev values ABOVE the
    server's current rev for the same entity - impossible within one
    timeline, so it is a reliable per-entity collision signal. Today the
    push answers a generic conflict, indistinguishable from a normal
    concurrent edit."""
    db = tmp_path / "restore.db"
    backup = tmp_path / "backup.db"
    with _server(db) as base:
        h = _register(base)
        assert _push(base, h, "t1", "one")["rev"] == 1
        _push(base, h, "t2", "two")
        _snapshot(db, backup)
        _push(base, h, "t3", "three")
        _push(base, h, "t4", "four")  # client's t1 edit would get base_rev up to 4
    _restore(db, backup)
    with _server(db) as base:
        # t1 is untouched post-restore: server rev 1, client base_rev 4.
        result = _push(base, h, "t1", "client newer edit", base_rev=4)
        assert result["status"] == "conflict"  # today: no anomaly signal
        assert set(result.keys()) == {"collection", "id", "status", "current"}
