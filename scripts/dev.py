#!/usr/bin/env python3
"""Run both local dev servers and stop the pair when either exits."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

root = Path(__file__).resolve().parents[1]
children = []


def stop(signum=None, frame=None):
    for child in children:
        if child.poll() is None:
            os.killpg(child.pid, signal.SIGTERM)


signal.signal(signal.SIGINT, stop)
signal.signal(signal.SIGTERM, stop)
try:
    for command, directory in [
        ([str(root / 'server/.venv/bin/uvicorn'), 'app.main:app', '--host', '127.0.0.1', '--port', '8787', '--no-proxy-headers'], root / 'server'),
        (['npm', 'run', 'dev', '--', '--host', '127.0.0.1'], root / 'app'),
    ]:
        children.append(subprocess.Popen(command, cwd=directory, start_new_session=True))
    while all(child.poll() is None for child in children):
        time.sleep(0.2)
    sys.exit(next((child.returncode for child in children if child.returncode not in (None, 0, -signal.SIGTERM)), 0))
finally:
    stop()
    for child in children:
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(child.pid, signal.SIGKILL)
            child.wait()
