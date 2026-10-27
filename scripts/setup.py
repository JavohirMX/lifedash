#!/usr/bin/env python3
"""Guided Compose setup. No secrets collected. Starts services only after consent."""
import argparse
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]


def check():
    if not shutil.which('docker'):
        print('Docker is not installed or not on PATH. Install Docker Engine and the Compose plugin, then rerun make setup.')
        return False
    for command, label in [(['docker', 'compose', 'version'], 'Compose plugin'),
                           (['docker', 'info'], 'Docker daemon access'),
                           (['docker', 'compose', 'config', '--quiet'], 'Compose configuration')]:
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
    print('Next action: docker compose up -d --build. It downloads/builds images, starts app/sync services and creates a persistent data volume.')
    try:
        answer = input('Build and start this stack now? [y/N] ').strip().lower()
    except (EOFError, KeyboardInterrupt):
        print('\nCancelled. No services started.')
        return 0
    if answer not in ('y', 'yes'):
        print('Skipped. No services started.')
        return 0
    try:
        result = subprocess.run(['docker', 'compose', 'up', '-d', '--build'], cwd=ROOT)
    except (OSError, KeyboardInterrupt):
        print('\nSetup interrupted. Some services may have started; inspect docker compose ps before retrying.')
        return 1
    if result.returncode:
        print('Build/start failed. Some services may exist. Inspect docker compose ps and docker compose logs; your data volume was not removed.')
        return 1
    print('Build/start command completed. Checking the default loopback API for up to 30 seconds...')
    deadline = time.monotonic() + 30
    while True:
        try:
            with urllib.request.urlopen('http://127.0.0.1:8787/api/health', timeout=2) as response:
                import json
                if response.status == 200 and json.load(response) == {'ok': True}:
                    break
        except (OSError, ValueError):
            pass
        if time.monotonic() >= deadline:
            print('Default API health not confirmed. Services were not stopped. Check logs and your configured host port; do not rerun blindly.')
            return 1
        time.sleep(0.5)
    print('Default loopback API responds. This alone does not prove TLS, browser sync or a changed port mapping.')
    print('1. With default ports, open http://localhost:8080 on this host, then Settings -> Sync. If you changed ports, use your configured URLs.')
    print('2. Enter http://localhost:8787 on this host and create the FIRST account. There is no default login or email password reset.')
    print('3. Root Compose closes registration after the first account; server/ Compose differs. Do not leave extra registration open by accident.')
    print('4. Set up HTTPS for app and API before other devices; sign into the same account on each. localhost on a phone means the phone.')
    print('5. Export device JSON and take a server backup. Both omit attachment binaries: keep original files separately. See /selfhost.html and server/SELFHOST.md.')
    print('Keep data with docker compose down. Never add -v for a routine stop/upgrade: it deletes the volume.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
