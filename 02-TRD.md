# LifeDash — Technical Requirements Document

**Status:** Draft | **Owner:** Javohir | **Last updated:** 2026-07-19

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────┐
│                   TV Display                     │
│         (1920×1080, HDMI from laptop)           │
│                                                  │
│  ┌───────────────────────────────────────────┐   │
│  │        Chromium (kiosk --fullscreen)      │   │
│  │     http://localhost:8765/index.html       │   │
│  └───────────────────────────────────────────┘   │
└─────────────────────┬───────────────────────────┘
                      │ fetch every 30s
                      ▼
┌─────────────────────────────────────────────────┐
│         Data Bridge (Python/FastAPI)             │
│            Port 8765 (internal only)             │
│                                                  │
│  GET /api/state → consolidated JSON blob         │
│                                                  │
└────┬────────────┬──────────────┬─────────────────┘
     │            │              │
     ▼            ▼              ▼
┌─────────┐ ┌──────────┐ ┌──────────────┐
│ Habits  │ │ Obsidian │ │  OpenBook    │
│ SQLite  │ │ Md File  │ │  HTTP API    │
│ DB      │ │ (todo)   │ │ (books.j...) │
└─────────┘ └──────────┘ └──────────────┘
```

## 2. Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| **Display** | Chromium kiosk mode | Libre, fullscreen, stable for 24/7 |
| **Frontend** | Vanilla HTML + CSS + JS | Zero build step, single file, loads instantly |
| **Font** | Inter or system sans-serif | Clean, legible at distance |
| **Data bridge** | Python + FastAPI | Reuses existing Python on homelab |
| **Data bridge host** | uvicorn | Lightweight ASGI server |
| **Habits DB** | SQLite (read-only) | No auth needed, direct local access |
| **To-dos** | File read (Obsidian markdown) | Already synced via Nextcloud |
| **OpenBook** | REST API over HTTP | Already has DRF endpoints |

## 3. Data Bridge API Specification

### `GET /api/state`

Returns a single JSON blob consumed by the dashboard.

```json
{
  "clock": {
    "now": "2026-07-19T14:30:00+08:00",
    "timezone": "Asia/Makassar"
  },
  "prayers": {
    "today": [
      {"name": "Fajr", "time": "04:45", "done": true},
      {"name": "Dhuhr", "time": "12:15", "done": true},
      {"name": "Asr", "time": "15:30", "done": false},
      {"name": "Maghrib", "time": "17:55", "done": false},
      {"name": "Isha", "time": "19:10", "done": false}
    ],
    "next": {"name": "Asr", "remaining_minutes": 60},
    "completed": 2,
    "total": 5
  },
  "habits": {
    "today_done": 3,
    "today_total": 5,
    "today_entries": [
      {"name": "wake_up", "label": "6 AM Wake-Up", "status": "done"},
      {"name": "exercise", "label": "Exercise", "status": "done"},
      {"name": "read", "label": "Read", "status": "missed"},
      {"name": "journal", "label": "Journal", "status": "done"},
      {"name": "no_screens", "label": "No Screens Before Bed", "status": "pending"}
    ],
    "streak": 14,
    "weekly_stats": {"mon": 5, "tue": 7, "wed": 6, "thu": 7, "fri": 0, "sat": 0, "sun": 0}
  },
  "todos": {
    "top": "Write PRD for LifeDash project",
    "urgent_count": 3,
    "total_pending": 12
  },
  "reading": {
    "current": "The Pragmatic Programmer",
    "author": "Andy Hunt",
    "progress_pct": 65,
    "status": "reading"
  },
  "highlight": "First day of LifeDash project — TV finally useful"
}
```

## 4. Data Source Details

| Source | Access method | Path / URL | Refresh |
|--------|--------------|------------|---------|
| Habits SQLite | `sqlite3` read | `~/.hermes/<profile>/habits.db` | Every 30s |
| Obsidian todo | File read | `~/Nextcloud/.../ToDo/inbox.md` | Every 60s |
| OpenBook | HTTP API | `http://openbook-openbook:8000/api/v1/books/?status=reading` | Every 120s |
| Prayer times | Derived from habit tracker data | Habit MCP schedule data | Daily |

## 5. Deployment

- Data bridge runs as a **systemd user service** or **Docker container** on the homelab
- Serves on `localhost:8765` (no external exposure — internal only)
- Chromium launches at display login via `~/.config/autostart/` or systemd user session
- Caching layer in data bridge: staleness tolerance configurable per source

## 6. Kiosk Launch Command

```bash
chromium-browser --kiosk --disable-infobars \
  --no-first-run --disable-restore-session-state \
  --check-for-update-interval=604800 \
  --disable-session-crashed-bubble \
  http://localhost:8765
```

## 7. Burn-in Mitigation

- Subtle content animation (slow pulse, gentle 1px parallax)
- Time-of-day mode transitions shift layout
- "Breathing" clock digits (slight opacity pulse)
- Optional: periodic full-screen content shift every 15 min
