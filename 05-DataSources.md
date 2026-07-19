# LifeDash — Data Sources & Integration

**Status:** Draft | **Owner:** Javohir | **Last updated:** 2026-07-19

---

## 1. Source Inventory

| Data | Source type | Protocol | Location | Auth |
|------|------------|----------|----------|------|
| Habits | SQLite DB | Local file read | `~/.hermes/<profile>/habits.db` | None (filesystem) |
| Prayer times | SQLite (habits DB) | Query prayer tracker | Same as above | None |
| To-dos | Markdown file | File read | `~/Nextcloud/.../ToDo/inbox.md` | None (filesystem) |
| OpenBook | REST API | HTTP | `http://openbook-openbook:8000` | API token (config) |
| Today's highlight | SQLite (habits DB) | Query highlights table | Same as habits | None |

## 2. Habits SQLite Schema (Read)

The habits MCP stores data in SQLite. The data bridge reads these tables:

**`habit_logs`** (or equivalent — confirmed at build time)

| Column | Purpose |
|--------|---------|
| `habit_name` | e.g. `wake_up`, `exercise` |
| `date` | YYYY-MM-DD |
| `status` | `done` / `late` / `missed` / `skip` |
| `value` | Optional metric (e.g. minutes) |

**`moments`**

| Column | Purpose |
|--------|---------|
| `date` | YYYY-MM-DD |
| `text` | Memorable moment / highlight entry |

**`tracker_values`** (for prayer tracking)

| Column | Purpose |
|--------|---------|
| `tracker_name` | e.g. `fajr`, `dhuhr`, etc. |
| `date` | YYYY-MM-DD |
| `value` | Boolean or timestamp |

### Example Queries

```sql
-- Today's habit completions
SELECT habit_name, status FROM habit_logs WHERE date = date('now');

-- Weekly habit stats
SELECT date, COUNT(*) as done
FROM habit_logs
WHERE date >= date('now', '-7 days') AND status = 'done'
GROUP BY date
ORDER BY date;

-- Today's highlight
SELECT text FROM moments WHERE date = date('now') LIMIT 1;
```

## 3. To-Do File Format

Reads from **`~/Nextcloud/Documents/obsidian/second-brain/ToDo/inbox.md`**.

Parsing rules:
- Line 1 after `## Today` heading = top todo
- If no `## Today` section, first unchecked task in file
- Checked tasks: `- [x] ...` — ignored
- Unchecked tasks: `- [ ] ...` — candidate
- Count total unchecked as "pending"

## 4. OpenBook API

**Endpoint:** `GET /api/v1/books/?status=reading&limit=1`

**Response shape:**
```json
{
  "results": [
    {
      "id": "uuid-here",
      "title": "The Pragmatic Programmer",
      "authors": [{"name": "Andy Hunt"}],
      "progress": {"current_page": 180, "total_pages": 280}
    }
  ]
}
```

**Data bridge caches this for 120 seconds** — OpenBook is read-only and doesn't change rapidly.

## 5. Data Bridge API

### `GET /api/state`

**Cache headers:** `Cache-Control: no-cache` (browser always fetches fresh)

**Response time target:** <200ms (all sources are local)

**Error handling:**
- If a source errors → omit that key from response, log to stderr
- Never return HTTP error — always return 200 with partial data
- Include a `_sources` metadata field showing which sources returned ok/failed

**Rate limiting:** None (internal only, one consumer)

## 6. Configuration

A single YAML or TOML file at `~/.lifedash/config.toml`:

```toml
[habits]
db_path = "~/.hermes/default/habits.db"

[todos]
file_path = "~/Nextcloud/Documents/obsidian/second-brain/ToDo/inbox.md"

[openbook]
api_url = "http://openbook-openbook:8000"
api_key = "optional-token"
cache_ttl = 120

[dashboard]
refresh_interval = 30  # seconds
port = 8765
```

## 7. System Dependencies

| Dependency | Version | Why |
|-----------|---------|-----|
| Python | ≥3.11 | Already on homelab |
| FastAPI | ≥0.110 | Async, lightweight |
| uvicorn | ≥0.30 | ASGI server |
| httpx | ≥0.27 | Async HTTP for OpenBook |
| aiosqlite | ≥0.20 | Async SQLite reads |
| Chromium | Latest | Kiosk display |
