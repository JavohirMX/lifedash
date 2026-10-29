"""Real-server regressions: uvicorn's default --proxy-headers handling
trusts loopback and rewrites request.client.host from the raw
X-Forwarded-For header BEFORE the app sees it, which would bypass the
app's own trusted-proxy checks. The shipped launch paths pass
--no-proxy-headers so the app's SYNC_TRUSTED_PROXY_HOPS / _IPS logic is
the single place that resolves the client address. These tests boot the
real server over a real socket and replay the spoof."""

import contextlib
import os
import socket
import sqlite3
import subprocess
import sys
import time
import urllib.request

import pytest

SERVER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@contextlib.contextmanager
def real_server(db_path, extra_env=None, extra_flags=()):
    env = {**os.environ, "SYNC_DB": str(db_path), "SYNC_OPEN_REGISTRATION": "0"}
    env.pop("SYNC_TRUSTED_PROXY_HOPS", None)
    env.pop("SYNC_TRUSTED_PROXY_IPS", None)
    env.update(extra_env or {})
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        listener.listen(128)
        port = listener.getsockname()[1]
        proc = subprocess.Popen(
            [sys.executable, "-m", "uvicorn", "app.main:app", "--fd", str(listener.fileno()),
             "--no-proxy-headers", *extra_flags],
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
                        raise RuntimeError("uvicorn did not become healthy in 20s")
                    time.sleep(0.1)
            yield port
        finally:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()


def post_login(port, username, xff=None):
    headers = {"Content-Type": "application/json"}
    if xff:
        headers["X-Forwarded-For"] = xff
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/login",
        data=("{\"username\": \"%s\", \"password\": \"wrong password\"}" % username).encode(),
        headers=headers, method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def register_user(port, username):
    req = urllib.request.Request(
        f"http://127.0.0.1:{port}/api/register",
        data=("{\"username\": \"%s\", \"password\": \"correct horse battery staple\"}" % username).encode(),
        headers={"Content-Type": "application/json"}, method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as r:
        assert r.status == 200


@pytest.fixture()
def db_path(tmp_path):
    return tmp_path / "real.db"


def test_real_server_ignores_spoofed_xff(db_path):
    # Shipped launch (--no-proxy-headers): rotating XFF from loopback is
    # ignored; the peer is the key, so the attack throttles itself.
    with real_server(db_path) as port:
        register_user(port, "alice")
        codes = [post_login(port, "alice", xff=f"9.0.0.{i}") for i in range(8)]
        assert codes == [401] * 6 + [429] * 2
    conn = sqlite3.connect(db_path)
    n = conn.execute("SELECT COUNT(*) FROM login_throttle WHERE username = 'alice'").fetchone()[0]
    assert n == 1
    assert conn.execute("SELECT ip FROM login_throttle WHERE username = 'alice'").fetchone()[0] == "127.0.0.1"


def test_real_server_trusted_proxy_hops(db_path):
    # With hops=1 the app (not uvicorn) resolves XFF: the rightmost entry
    # is the client, attacker-controlled left entries change nothing.
    with real_server(db_path, extra_env={"SYNC_TRUSTED_PROXY_HOPS": "1"}) as port:
        register_user(port, "bob")
        codes = [post_login(port, "bob", xff=f"10.1.1.{i}, 203.0.113.9") for i in range(8)]
        assert codes == [401] * 6 + [429] * 2
        # The same account from a different rightmost entry is unaffected.
        assert post_login(port, "bob", xff="10.1.1.1, 198.51.100.4") == 401
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT COUNT(*) FROM login_throttle WHERE username = 'bob'").fetchone()[0] == 2


def test_every_repo_launch_path_disables_uvicorn_proxy_headers():
    # Every uvicorn launch line in the repo must carry the flag; the
    # app's own XFF resolution is the only one allowed to run.
    root = os.path.dirname(SERVER)
    launches = 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ("node_modules", ".venv", "__pycache__", ".git", "build", "dist")]
        for name in filenames:
            path = os.path.join(dirpath, name)
            if "test" in name or not name.endswith((".py", ".md", ".sh")) and name not in ("Dockerfile", "Makefile"):
                continue
            with open(path, errors="ignore") as f:
                for line in f:
                    if "uvicorn" in line and "app.main:app" in line:
                        launches += 1
                        assert "--no-proxy-headers" in line, (
                            f"{path} launches uvicorn without --no-proxy-headers: {line.strip()!r}"
                        )
    assert launches >= 7, f"expected at least 7 uvicorn launch lines, found {launches}"
