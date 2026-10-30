#!/usr/bin/env python3
"""Disposable loopback sync smoke test. Never opens a user's database.

Run with the server venv's Python. Exercises a real uvicorn process, graceful
restart, and SQLite's online backup/restore. This is not a Docker/TLS test.
"""
from contextlib import contextmanager
import json
from pathlib import Path
import os
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

SERVER = Path(__file__).resolve().parents[1] / 'server'


def request(url, path, body=None, token=None, expected=200):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(url + path, headers=headers,
                                 data=json.dumps(body).encode() if body is not None else None)
    try:
        response = urllib.request.urlopen(req, timeout=3)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        data = response.read()
        if response.status != expected:
            raise AssertionError(f'{path}: expected {expected}, got {response.status}')
        return json.loads(data) if data else None


@contextmanager
def serve(db, directory):
    # Inherit an already-bound socket, avoiding a free-port lookup/start race.
    with socket.socket() as listener, (directory / 'uvicorn.log').open('ab') as log:
        listener.bind(('127.0.0.1', 0))
        listener.listen(128)
        url = f'http://127.0.0.1:{listener.getsockname()[1]}'
        env = {**os.environ, 'SYNC_DB': str(db), 'SYNC_OPEN_REGISTRATION': '0'}
        process = subprocess.Popen(
            [sys.executable, '-m', 'uvicorn', 'app.main:app', '--fd', str(listener.fileno()), '--no-proxy-headers'],
            cwd=SERVER, env=env, pass_fds=(listener.fileno(),), stdout=log, stderr=log,
        )
        try:
            deadline = time.monotonic() + 15
            while True:
                if process.poll() is not None:
                    raise RuntimeError('uvicorn exited before becoming healthy')
                try:
                    assert request(url, '/api/health') == {'ok': True}
                    break
                except (OSError, AssertionError):
                    if time.monotonic() >= deadline:
                        raise RuntimeError('uvicorn did not become healthy in 15 seconds')
                    time.sleep(0.1)
            yield url
        finally:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


def main():
    if os.name != 'posix':
        raise SystemExit('This loopback process check requires a POSIX host.')
    with tempfile.TemporaryDirectory(prefix='lifedash-selfhost-') as temp:
        directory = Path(temp)
        db, backup = directory / 'live.db', directory / 'backup.db'
        credentials = {'username': 'synthetic-selfhost-check', 'password': 'fictional-smoke-password'}
        try:
            with serve(db, directory) as url:
                token = request(url, '/api/register', credentials)['token']
                request(url, '/api/register', {**credentials, 'username': 'second'}, expected=403)
                request(url, '/api/changes', expected=401)
                change = {'collection': 'tasks', 'id': 'synthetic-task', 'base_rev': 0,
                          'data': {'title': 'Synthetic persisted task'}}
                result = request(url, '/api/changes', {'changes': [change]}, token)
                assert result['results'][0]['rev'] == 1
                # Online backup, while the server is still running in WAL mode.
                with sqlite3.connect(db) as src, sqlite3.connect(backup) as dst:
                    src.backup(dst)
                result = request(url, '/api/changes', {'changes': [
                    {**change, 'base_rev': 1, 'data': {'title': 'After backup'}}]}, token)
                assert result['results'][0]['rev'] == 2
            with serve(db, directory) as url:
                persisted = request(url, '/api/changes?since=0', token=token)
                assert persisted['rev'] == 2
                assert persisted['changes'][0]['data']['title'] == 'After backup'
                assert request(url, '/api/login', credentials)['token']
            # Serve the copied snapshot as its own database, not over the live file.
            with serve(backup, directory) as url:
                restored = request(url, '/api/changes?since=0', token=token)
                assert restored['rev'] == 1
                assert restored['changes'][0]['data']['title'] == 'Synthetic persisted task'
                assert request(url, '/api/login', credentials)['token']
                request(url, '/api/register', {**credentials, 'username': 'second'}, expected=403)
        except Exception:
            # Logs contain only synthetic localhost activity; no auth bodies.
            log = directory / 'uvicorn.log'
            if log.exists():
                print(log.read_text(), file=sys.stderr)
            raise
    print('PASS: loopback API, auth, closed registration, restart persistence, online backup and restored login/data')
    print('Synthetic temporary databases removed. Docker, TLS and real-device sync are not covered.')


if __name__ == '__main__':
    main()
