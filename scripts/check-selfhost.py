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
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

SERVER = Path(__file__).resolve().parents[1] / 'server'


def request(url, path, body=None, token=None, expected=200, raw=False):
    headers = {'Content-Type': 'application/octet-stream' if isinstance(body, bytes) else 'application/json'}
    if token:
        headers['Authorization'] = f'Bearer {token}'
    req = urllib.request.Request(url + path, headers=headers,
                                 data=body if isinstance(body, bytes) else json.dumps(body).encode() if body is not None else None)
    try:
        response = urllib.request.urlopen(req, timeout=3)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        data = response.read()
        if response.status != expected:
            raise AssertionError(f'{path}: expected {expected}, got {response.status}')
        return data if raw else json.loads(data) if data else None


@contextmanager
def serve(db, directory):
    # Inherit an already-bound socket, avoiding a free-port lookup/start race.
    with socket.socket() as listener, (directory / 'uvicorn.log').open('ab') as log:
        listener.bind(('127.0.0.1', 0))
        listener.listen(128)
        url = f'http://127.0.0.1:{listener.getsockname()[1]}'
        env = {**os.environ, 'SYNC_DB': str(db),
               'SYNC_BLOB_DIR': str(db.with_suffix('.blobs')), 'SYNC_OPEN_REGISTRATION': '0'}
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
                # Use a client-readable task, not merely a server-accepted blob.
                # The generic changes endpoint deliberately stores opaque data.
                task = {
                    'id': 'synthetic-task', 'title': 'Synthetic persisted task',
                    'projectId': 'inbox', 'status': 'active', 'parentId': None,
                    'note': '', 'noteDoc': None, 'goalId': None, 'noteId': None,
                    'pinned': False, 'priority': 0, 'order': 0,
                    'dueDate': None, 'dueTime': None, 'recurrence': None,
                    'blockedBy': [], 'tags': [], 'seriesId': None,
                    'completedAt': None, 'createdAt': 1700000000000,
                    'updatedAt': 1700000000000,
                }
                change = {'collection': 'tasks', 'id': task['id'], 'base_rev': 0,
                          'data': task}
                result = request(url, '/api/changes', {'changes': [change]}, token)
                assert result['results'][0]['rev'] == 1
                attachment_bytes = b'synthetic attachment bytes\x00\xff'
                attachment = request(url, '/api/attachments?task_id=synthetic-task&filename=check.bin&id=synthetic-file',
                                     attachment_bytes, token, expected=201)
                content_path = f"/api/attachments/{attachment['id']}/content"
                assert request(url, content_path, token=token, raw=True) == attachment_bytes
                # This synthetic workload is idle during both copies. It is not
                # proof that an online DB/blob pair is atomic with other writers.
                blob_snapshot = directory / 'blob-snapshot'
                shutil.copytree(db.with_suffix('.blobs'), blob_snapshot)
                # Online backup, while the server is still running in WAL mode.
                with sqlite3.connect(db) as src, sqlite3.connect(backup) as dst:
                    src.backup(dst)
                updated_task = {**task, 'title': 'After backup', 'updatedAt': 1700000001000}
                result = request(url, '/api/changes', {'changes': [
                    {**change, 'base_rev': 1, 'data': updated_task}]}, token)
                assert result['results'][0]['rev'] == 3
            with serve(db, directory) as url:
                persisted = request(url, '/api/changes?since=0', token=token)
                assert persisted['rev'] == 3
                assert next(c['data'] for c in persisted['changes'] if c['id'] == task['id']) == updated_task
                assert request(url, content_path, token=token, raw=True) == attachment_bytes
                assert request(url, '/api/login', credentials)['token']
            # Negative control: the SQLite backup alone has metadata, not bytes.
            # Its explicit isolated blob path must not fall back to live blobs.
            with serve(backup, directory) as url:
                request(url, content_path, token=token, raw=True, expected=404)
            shutil.copytree(blob_snapshot, backup.with_suffix('.blobs'), dirs_exist_ok=True)
            # Serve the copied snapshot as its own database, not over the live file.
            with serve(backup, directory) as url:
                restored = request(url, '/api/changes?since=0', token=token)
                assert restored['rev'] == 2
                assert next(c['data'] for c in restored['changes'] if c['id'] == task['id']) == task
                assert request(url, content_path, token=token, raw=True) == attachment_bytes
                assert request(url, '/api/login', credentials)['token']
                request(url, '/api/register', {**credentials, 'username': 'second'}, expected=403)
        except Exception:
            # Logs contain only synthetic localhost activity; no auth bodies.
            log = directory / 'uvicorn.log'
            if log.exists():
                print(log.read_text(), file=sys.stderr)
            raise
    print('PASS: loopback API, auth, closed registration, restart persistence, online DB/blob backup and restored login/data/attachment bytes')
    print('Synthetic temporary databases removed. Docker, TLS and real-device sync are not covered.')


if __name__ == '__main__':
    main()
