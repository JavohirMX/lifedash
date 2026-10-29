"""SQLite storage layer for the Lifedash sync server.

One file database (env SYNC_DB, default /data/lifedash.db), WAL mode,
thread-local connections. Entities are opaque JSON blobs keyed by
(user_id, collection, id) with a per-user monotonic revision counter
stored in the meta table - that counter is the changes-feed cursor.
"""

import os
import sqlite3
import threading

DB_PATH = os.environ.get("SYNC_DB", "/data/lifedash.db")

_local = threading.local()

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS tokens (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS meta (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_rev INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS entities (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  collection TEXT NOT NULL,
  id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (user_id, collection, id)
);
CREATE INDEX IF NOT EXISTS idx_entities_rev ON entities(user_id, rev);
"""


def get_conn() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        parent = os.path.dirname(DB_PATH)
        if parent:
            os.makedirs(parent, exist_ok=True)
        conn = sqlite3.connect(DB_PATH, timeout=30)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


def _migrate(conn) -> None:
    cols = [r["name"] for r in conn.execute("PRAGMA table_info(entities)")]
    if "deleted_with" not in cols:
        conn.execute("ALTER TABLE entities ADD COLUMN deleted_with TEXT")


def init_db() -> None:
    conn = get_conn()
    conn.executescript(SCHEMA)
    _migrate(conn)
    conn.commit()
