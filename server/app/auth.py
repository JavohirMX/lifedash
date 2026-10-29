"""Username/password auth with opaque bearer tokens.

Passwords are PBKDF2-HMAC-SHA256 (stdlib hashlib). Session tokens are
secrets.token_urlsafe(32); only their SHA-256 digest is stored, so a
database read does not hand out live sessions. Self-hosted single
deployment: registration is open for the first user, then closed
unless SYNC_OPEN_REGISTRATION=1.
"""

import hashlib
import hmac
import secrets

from fastapi import Header, HTTPException

from .db import get_conn

PBKDF2_ITERATIONS = 200_000


def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return salt.hex() + ":" + dk.hex()


def verify_password(password: str, stored: str) -> bool:
    try:
        salt_hex, _ = stored.split(":", 1)
        salt = bytes.fromhex(salt_hex)
    except ValueError:
        return False
    return hmac.compare_digest(hash_password(password, salt), stored)


def new_token() -> str:
    return secrets.token_urlsafe(32)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _is_digest(value: str) -> bool:
    return len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def store_token(user_id: int) -> str:
    """Create a session token; only its digest reaches the database."""
    token = new_token()
    get_conn().execute(
        "INSERT INTO tokens (token, user_id) VALUES (?, ?)", (hash_token(token), user_id)
    )
    get_conn().commit()
    return token


def migrate_tokens() -> int:
    """One-time upgrade: replace plaintext session tokens with digests.

    Idempotent. Clients keep working - they present the plaintext bearer,
    which is hashed for the lookup.
    """
    conn = get_conn()
    rows = conn.execute("SELECT token FROM tokens").fetchall()
    migrated = 0
    for r in rows:
        t = r["token"]
        if not _is_digest(t):
            conn.execute("UPDATE tokens SET token = ? WHERE token = ?", (hash_token(t), t))
            migrated += 1
    if migrated:
        conn.commit()
    return migrated


def current_user(authorization: str = Header(default="")) -> int:
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len(prefix):].strip()
    conn = get_conn()
    row = conn.execute("SELECT user_id FROM tokens WHERE token = ?", (hash_token(token),)).fetchone()
    if row is not None:
        return row["user_id"]
    # Legacy plaintext row from a pre-hardening database that never ran the
    # startup migration: authenticate once, then upgrade it in place.
    row = conn.execute("SELECT user_id FROM tokens WHERE token = ?", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="invalid token")
    conn.execute("UPDATE tokens SET token = ? WHERE token = ?", (hash_token(token), token))
    conn.commit()
    return row["user_id"]
