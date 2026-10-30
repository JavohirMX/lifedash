"""Real-vendor proof: official Caddy v2.11.7 (SHA-512 verified against
the release's published checksums) terminating TLS with its own local
CA in front of uvicorn, replicating docs/self-host-hardening.md's
deployment. Unprivileged, loopback only.

Proves the actual Caddy config path: its default X-Forwarded-For
behavior, real vendor TLS termination, and the app's
SYNC_TRUSTED_PROXY_HOPS=1 resolution through the real chain.

To reproduce the fixture binary (unprivileged, no bundling):
  curl -sLO https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_linux_amd64.tar.gz
  curl -sLO https://github.com/caddyserver/caddy/releases/download/v2.11.7/caddy_2.11.7_checksums.txt
  # verify the tar's SHA-512 against checksums.txt, then: tar xzf ... caddy
  CADDY_BIN=/path/to/caddy python -m pytest tests/test_caddy_proxy.py
Version: Caddy v2.11.7; asset caddy_2.11.7_linux_amd64.tar.gz;
SHA-512 (from the release's checksums.txt - always re-verify):
  a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7
"""

import http.client
import http.server
import json
import os
import socket
import ssl
import subprocess
import threading

import pytest

from tests.test_real_server import real_server

SERVER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.dirname(SERVER)
CADDY = os.environ.get("CADDY_BIN", "/tmp/caddy/caddy")

pytestmark = pytest.mark.skipif(not os.path.exists(CADDY), reason="official caddy binary not present")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class _Echo(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        payload = json.dumps({"xff": self.headers.get("X-Forwarded-For"),
                              "host": self.headers.get("Host")}).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


def start_caddy(tmp_path, upstream_port):
    port = free_port()
    caddyfile = tmp_path / "Caddyfile"
    caddyfile.write_text(
        "{\n"
        "    admin off\n"
        "    auto_https disable_redirects\n"  # unprivileged: no :80 redirect listener
        "}\n"
        f"https://127.0.0.1:{port} {{\n"
        f"    tls internal\n"
        f"    reverse_proxy 127.0.0.1:{upstream_port}\n"
        f"}}\n"
    )
    data_home = tmp_path / "xdg"
    env = {**os.environ, "XDG_DATA_HOME": str(data_home), "XDG_CONFIG_HOME": str(data_home), "HOME": str(data_home)}
    proc = subprocess.Popen([CADDY, "run", "--config", str(caddyfile)],
                            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    root_ca = data_home / "caddy" / "pki" / "authorities" / "local" / "root.crt"
    import time
    deadline = time.monotonic() + 20
    while not root_ca.exists():
        if proc.poll() is not None or time.monotonic() >= deadline:
            raise RuntimeError("caddy did not initialize its local CA")
        time.sleep(0.1)
    # The CA file appears before the TLS listener accepts: certificate
    # obtain and bind finish after the root cert is written. Wait for the
    # port itself, or a fast test connects into the gap (ConnectionRefused).
    import socket
    listen_deadline = time.monotonic() + 20
    while True:
        try:
            probe = socket.create_connection(("127.0.0.1", port), timeout=1)
            probe.close()
            break
        except OSError:
            if proc.poll() is not None or time.monotonic() >= listen_deadline:
                raise RuntimeError("caddy did not start its TLS listener")
            time.sleep(0.1)
    ctx = ssl.create_default_context(cafile=str(root_ca))
    return proc, port, ctx


def call(port, ctx, method, path, payload=None, token=None, source=None, xff=None):
    conn = http.client.HTTPSConnection(
        "127.0.0.1", port, timeout=30, context=ctx,
        source_address=source,
    )
    headers = {"Content-Type": "application/json", "Host": "127.0.0.1"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if xff:
        headers["X-Forwarded-For"] = xff
    conn.request(method, path, body=json.dumps(payload) if payload is not None else None, headers=headers)
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    return resp.status, json.loads(data) if data else {}


def test_caddy_replaces_inbound_xff(tmp_path):
    # Establish the vendor fact the docs claim: what does Caddy's
    # reverse_proxy actually send upstream when the client supplies XFF?
    echo = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _Echo)
    threading.Thread(target=echo.serve_forever, daemon=True).start()
    proc, port, ctx = start_caddy(tmp_path, echo.server_address[1])
    try:
        _, body = call(port, ctx, "GET", "/", xff="203.0.113.99, 198.51.100.1")
        assert body["xff"] == "127.0.0.1", body  # replaced, not appended
    finally:
        proc.terminate(); proc.wait(timeout=10)
        echo.shutdown()


@pytest.fixture(scope="module")
def caddy_stack(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("caddy")
    db = tmp / "caddy.db"
    with real_server(db, extra_env={"SYNC_OPEN_REGISTRATION": "1", "SYNC_TRUSTED_PROXY_HOPS": "1"}) as app_port:
        proc, port, ctx = start_caddy(tmp, app_port)
        yield port, ctx, db
        proc.terminate(); proc.wait(timeout=10)


def test_register_login_through_real_caddy_tls(caddy_stack):
    port, ctx, _ = caddy_stack
    s, body = call(port, ctx, "POST", "/api/register", {"username": "cuser", "password": "correct horse battery staple"})
    assert s == 200 and body["token"]
    s, body = call(port, ctx, "POST", "/api/login", {"username": "cuser", "password": "correct horse battery staple"})
    assert s == 200 and body["token"]


def test_spoofed_xff_throttles_through_real_caddy(caddy_stack):
    port, ctx, db = caddy_stack
    call(port, ctx, "POST", "/api/register", {"username": "cvictim", "password": "correct horse battery staple"})
    codes = [
        call(port, ctx, "POST", "/api/login", {"username": "cvictim", "password": "wrong password"},
             source=("127.0.0.3", 0), xff=f"10.9.9.{i}")[0]
        for i in range(8)
    ]
    assert codes == [401] * 6 + [429] * 2
    import sqlite3
    conn = sqlite3.connect(db)
    rows = conn.execute("SELECT ip FROM login_throttle WHERE username = 'cvictim'").fetchall()
    assert rows == [("127.0.0.3",)], rows


def test_per_source_isolation_through_real_caddy(caddy_stack):
    port, ctx, _ = caddy_stack
    s, body = call(port, ctx, "POST", "/api/login", {"username": "cvictim", "password": "correct horse battery staple"},
                   source=("127.0.0.2", 0))
    assert s == 200 and body["token"]


def test_plain_http_to_caddy_tls_port_fails(caddy_stack):
    port, _, _ = caddy_stack
    import urllib.request
    with pytest.raises(Exception):
        urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5)
