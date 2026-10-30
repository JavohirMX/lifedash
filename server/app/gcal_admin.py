"""Key tools for the optional Google Calendar display.

  python -m app.gcal_admin genkey   print a new key (store it in a file, never in the repo)
  python -m app.gcal_admin rotate   re-encrypt stored tokens with the first key in SYNC_SECRET_KEYS
  python -m app.gcal_admin check    count tokens the first key alone cannot read (must be 0 before dropping an old key)
"""

import sys

from . import gcal


def main(argv: list[str]) -> int:
    if len(argv) == 2 and argv[1] == "genkey":
        from cryptography.fernet import Fernet

        print(Fernet.generate_key().decode())
        return 0
    if len(argv) == 2 and argv[1] == "rotate":
        try:
            r = gcal.rotate_tokens()
        except RuntimeError as e:
            print(f"error: {e}", file=sys.stderr)
            return 2
        print(f"rotated {r['rotated']} token(s); {r['unreadable']} unreadable (those users must reconnect)")
        return 0 if r["unreadable"] == 0 else 1
    if len(argv) == 2 and argv[1] == "check":
        try:
            n = gcal.unrotated_count()
        except RuntimeError as e:
            print(f"error: {e}. Do NOT retire any key.", file=sys.stderr)
            return 2
        print(f"{n} token(s) not readable with the first key alone" if n else "0 token(s) unreadable with the first key alone (or none stored)")
        return 0 if n == 0 else 1
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
