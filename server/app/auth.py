"""Username/password auth with opaque bearer tokens.

Passwords are PBKDF2-HMAC-SHA256 (stdlib hashlib), tokens are
secrets.token_urlsafe(32) stored server-side. Self-hosted single
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


def current_user(authorization: str = Header(default="")) -> int:
    prefix = "Bearer "
    if not authorization.startswith(prefix):
        raise HTTPException(status_code=401, detail="missing bearer token")
    token = authorization[len(prefix):].strip()
    row = get_conn().execute("SELECT user_id FROM tokens WHERE token = ?", (token,)).fetchone()
    if row is None:
        raise HTTPException(status_code=401, detail="invalid token")
    return row["user_id"]
