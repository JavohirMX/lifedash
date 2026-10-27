#!/usr/bin/env python3
"""Guided Compose setup. No secrets collected. Starts services only after consent."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
# Pin this file: do not honor COMPOSE_FILE or implicit override-file discovery.
COMPOSE = ['docker', 'compose', '-f', str(ROOT / 'docker-compose.yml')]
HEALTH = "import json,urllib.request; r=urllib.request.urlopen('http://127.0.0.1:8787/api/health',timeout=2); assert r.status==200 and json.load(r)=={'ok':True}"


def check():
    if not shutil.which('docker'):
        print('Docker is not installed or not on PATH. Install Docker Engine and the Compose plugin, then rerun make setup.')
        return False
    for command, label in [(['docker', 'compose', 'version'], 'Compose plugin'),
                           (['docker', 'info'], 'Docker daemon access'),
                           ([*COMPOSE, 'config', '--quiet'], 'Compose configuration')]:
        try:
            result = subprocess.run(command, cwd=ROOT, capture_output=True, timeout=30)
        except (OSError, subprocess.TimeoutExpired):
            print(f'{label}: could not complete the check. Check Docker locally and try again.')
            return False
        if result.returncode:
            # Avoid printing rendered configuration, environment or daemon details.
            print(f'{label}: failed. Run {" ".join(command)} locally to inspect the error. Do not share secrets from its output.')
            return False
        print(f'{label}: OK')
    return True


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='check prerequisites/config only, never start services')
    args = parser.parse_args(argv)
    print('Lifedash self-host setup')
    print('Local-only use needs no sync account. This guide is for your own Compose host.')
    print('Keep the host private: the checked-in ports bind to network interfaces and the first visitor can claim an empty server.')
    if not check():
        return 1
    if args.check:
        print('Preflight complete. No services started; this does not validate an image build or deployment.')
        return 0
    if not sys.stdin.isatty():
        print('Interactive setup needs a terminal. Use --check for a read-only preflight.')
        return 1
    print('This helper uses only the repository root docker-compose.yml; COMPOSE_FILE and implicit override files are not used. Edit that file or use manual Compose for custom stacks.')
    print('Existing services in this Compose project may be rebuilt/recreated. The selected Docker context and COMPOSE_PROJECT_NAME still apply; verify they name your intended host/project first.')
    print('Next action: docker compose -f docker-compose.yml up -d --build. It downloads/builds images, starts app/sync services and creates or reuses a persistent data volume.')
    try:
        answer = input('Build and start this stack now? [y/N] ').strip().lower()
    except (EOFError, KeyboardInterrupt):
        print('\nCancelled. No services started.')
        return 0
    if answer not in ('y', 'yes'):
        print('Skipped. No services started.')
        return 0
    try:
        result = subprocess.run([*COMPOSE, 'up', '-d', '--build'], cwd=ROOT)
    except (OSError, KeyboardInterrupt):
        print('\nSetup interrupted. Some services may have started; inspect docker compose ps before retrying.')
        return 1
    if result.returncode:
        print('Build/start failed. Some services may exist. Inspect docker compose ps and docker compose logs; your data volume was not removed.')
        return 1
    print('Build/start command completed. Checking health INSIDE this Compose sync service for up to 30 seconds...')
    deadline = time.monotonic() + 30
    while True:
        try:
            result = subprocess.run([*COMPOSE, 'exec', '-T', 'sync', 'python', '-c', HEALTH],
                                    cwd=ROOT, capture_output=True, timeout=5)
            if result.returncode == 0:
                break
        except (OSError, subprocess.TimeoutExpired):
            pass
        if time.monotonic() >= deadline:
            print('Compose sync service health not confirmed. Services were not stopped. Check the selected project and its logs; do not rerun blindly.')
            return 1
        time.sleep(0.5)
    print('This Compose sync service responds internally. Host port reachability, TLS and browser sync are NOT verified.')
    print('Use docker compose -f docker-compose.yml port app 80 and port sync 8787 to inspect your published ports.')
    print('1. With default ports, open http://localhost:8080 on this host, then Settings -> Sync. If you changed ports, use your configured URLs.')
    print('2. Enter http://localhost:8787 on this host and create the FIRST account. There is no default login or email password reset.')
    print('3. Root Compose closes registration after the first account; server/ Compose differs. Do not leave extra registration open by accident.')
    print('4. Set up HTTPS for app and API before other devices; sign into the same account on each. localhost on a phone means the phone.')
    print('5. Export device JSON and take a server backup. Both omit attachment binaries: keep original files separately. See /selfhost.html and server/SELFHOST.md.')
    print('Keep data with docker compose down. Never add -v for a routine stop/upgrade: it deletes the volume.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
