# LifeDash — Product Requirements Document

**Status:** Draft | **Owner:** Javohir | **Last updated:** 2026-07-19

---

## 1. Problem Statement

Javohir already tracks his life across multiple systems — habits, prayers, to-dos, books, journal — but accessing any of them requires pulling out a phone, opening an app, and navigating to the right screen. This friction means he checks less often than he would like, and ambient awareness of his day's state is absent.

He has an unused TV directly in front of his workspace that can serve as a persistent, glanceable surface.

## 2. Who It's For

**Primary:** Javohir (single-user system, no multi-user requirement)

**Context:**
- Works from a desk in his room
- TV is mounted directly ahead of him
- Homelab laptop runs 24/7 on the same desk, connected by HDMI
- Asia/Makassar timezone
- Existing systems: Hermes habit MCP, Obsidian vault, OpenBook

## 3. Core Principle

> The dashboard must be useful within a single glance. If Javohir has to stare at it for more than 2 seconds to get value, it's failed.

## 4. Features

### MVP (Phase 1)

| Feature | What it shows | Data source |
|---------|---------------|------------|
| **Clock + Date** | Current time (big), date, day of week | Browser local |
| **Prayer status** | Next prayer name + countdown, today's completed prayers | Habits MCP |
| **Today's habits** | Progress bar: completed / total for today | Habits MCP |
| **Top todo** | Most urgent task from Obsidian inbox | Obsidian vault |

### Phase 2

| Feature | What it shows | Data source |
|---------|---------------|------------|
| **Weekly habit streak** | Grid or bar showing this week's completion rate | Habits MCP |
| **Current book** | What Javohir is reading right now | OpenBook API |
| **Today's highlight** | The memorable moment logged for today | Habits MCP |
| **Time-of-day modes** | Auto-switching layouts based on time of day | Browser local |

### Phase 3 (Stretch)

- Weather (local Makassar)
- Journal evening prompt
- Calendar events
- Animated background (subtle)
- Screen-saver / burn-in protection

## 5. Out of Scope (MVP)

- Multi-user support
- Mobile responsive layout (this is a TV dashboard only)
- Interactive touch controls (no touchscreen)
- Historical analytics or charts
- User authentication
- Anything requiring a build pipeline (webpack, npm, etc.)

## 6. Success Metrics

| Metric | Target |
|--------|--------|
| **Glance time** | User gets key info in ≤2 seconds |
| **Data freshness** | Habits/prayer data ≤60 seconds old |
| **Uptime** | Dashboard visible 24/7 without manual restart |
| **Burn-in risk** | No static elements visible for >30 min without movement |

## 7. Constraints

- TV is standard 1080p or 4K, connected via HDMI
- Browser must run in fullscreen/kiosk mode
- No additional hardware purchases (use existing homelab laptop)
- Minimal power draw — this is already-running hardware
- Dashboard must survive browser crashes (auto-restart)
