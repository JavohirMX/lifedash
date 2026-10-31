"""Isolated-fixture proof of the documented deployment shape: a
TLS-terminating reverse proxy on loopback in front of uvicorn, with the
app resolving the client address via SYNC_TRUSTED_PROXY_HOPS=1.

The fixture proxy is stdlib Python, not nginx/Caddy, so this proves the
APP's behavior behind a spec-faithful append-style proxy hop
($proxy_add_x_forwarded_for semantics) over real TLS and sockets. The
operators' actual proxy config syntax and Docker image remain unproven
here.
"""

import http.client
import http.server
import json
import os
import socket
import ssl
import subprocess
import threading
import urllib.request

import pytest

from tests.test_real_server import real_server

SERVER = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


@pytest.fixture(scope="module")
def cert(tmp_path_factory):
    d = tmp_path_factory.mktemp("tls")
    key, crt = str(d / "key.pem"), str(d / "crt.pem")
    subprocess.run(
        ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
         "-keyout", key, "-out", crt, "-days", "1", "-subj", "/CN=localhost"],
        check=True, capture_output=True,
    )
    return key, crt


class _ProxyHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _forward(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        prior = self.headers.get("X-Forwarded-For")
        # $proxy_add_x_forwarded_for semantics: append the peer we saw.
        xff = f"{prior}, {self.client_address[0]}" if prior else self.client_address[0]
        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("connection", "x-forwarded-for", "host", "content-length")}
        headers["X-Forwarded-For"] = xff
        headers["Connection"] = "close"
        upstream = http.client.HTTPConnection("127.0.0.1", self.server.app_port, timeout=30)
        upstream.request(self.command, self.path, body=body, headers=headers)
        resp = upstream.getresponse()
        payload = resp.read()
        self.send_response(resp.status)
        for k, v in resp.getheaders():
            if k.lower() in ("connection", "transfer-encoding", "content-length"):
                continue
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Connection", "close")
        self.end_headers()
        self.wfile.write(payload)
        self.close_connection = True

    do_GET = do_POST = do_PUT = do_DELETE = do_PATCH = _forward

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def tls_proxy(tmp_path_factory, cert):
    key, crt = cert
    db = tmp_path_factory.mktemp("db") / "proxied.db"
    with real_server(db, extra_env={"SYNC_OPEN_REGISTRATION": "1", "SYNC_TRUSTED_PROXY_HOPS": "1"}) as app_port:
        srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), _ProxyHandler)
        srv.app_port = app_port
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(crt, key)
        srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        yield srv.server_address[1], db
        srv.shutdown()


def call(port, method, path, payload=None, token=None, source=None, xff=None):
    conn = http.client.HTTPSConnection(
        "127.0.0.1", port, timeout=30,
        context=ssl._create_unverified_context(),
        source_address=source,
    )
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    if xff:
        headers["X-Forwarded-For"] = xff
    conn.request(method, path, body=json.dumps(payload) if payload is not None else None, headers=headers)
    resp = conn.getresponse()
    data = resp.read()
    conn.close()
    return resp.status, json.loads(data) if data else {}


def test_register_and_login_over_tls_through_proxy(tls_proxy):
    port, _ = tls_proxy
    s, body = call(port, "POST", "/api/register", {"username": "tlsuser", "password": "correct horse battery staple"})
    assert s == 200 and body["token"]
    s, body = call(port, "POST", "/api/login", {"username": "tlsuser", "password": "correct horse battery staple"})
    assert s == 200 and body["token"]


def test_plain_http_to_tls_port_fails(tls_proxy):
    port, _ = tls_proxy
    with pytest.raises(Exception):
        urllib.request.urlopen(f"http://127.0.0.1:{port}/api/health", timeout=5)


def test_spoofed_xff_left_entries_throttle_through_proxy(tls_proxy):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as _probe:
            _probe.bind(("127.0.0.3", 0))
    except OSError:
        pytest.skip("Loopback alias 127.0.0.3 not available on host (run on Linux/CI or configure alias)")
    port, db = tls_proxy
    call(port, "POST", "/api/register", {"username": "victim", "password": "correct horse battery staple"})
    # One real source (127.0.0.3) rotating attacker-controlled left entries.
    codes = [
        call(port, "POST", "/api/login", {"username": "victim", "password": "wrong password"},
             source=("127.0.0.3", 0), xff=f"10.9.9.{i}")[0]
        for i in range(8)
    ]
    assert codes == [401] * 6 + [429] * 2
    import sqlite3
    conn = sqlite3.connect(db)
    rows = conn.execute("SELECT ip FROM login_throttle WHERE username = 'victim'").fetchall()
    assert rows == [("127.0.0.3",)], rows


def test_throttle_isolation_between_real_sources_through_proxy(tls_proxy):
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as _probe:
            _probe.bind(("127.0.0.2", 0))
    except OSError:
        pytest.skip("Loopback alias 127.0.0.2 not available on host (run on Linux/CI or configure alias)")
    port, _ = tls_proxy
    # victim is throttled from 127.0.0.3 above; the same account from a
    # different real source signs straight in.
    s, body = call(port, "POST", "/api/login", {"username": "victim", "password": "correct horse battery staple"},
                   source=("127.0.0.2", 0))
    assert s == 200 and body["token"]
