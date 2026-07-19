# LifeDash — Implementation Plan

**Status:** Draft | **Owner:** Javohir | **Last updated:** 2026-07-19

---

## 1. Build Order

```
Phase 0 ──→ Phase 1 ──→ Phase 2 ──→ Phase 3 ──→ Phase 4
                  │                                    │
                  ▼                                    ▼
           (all Phases 0-3)                       TV LIVE
```

| Phase | Name | Dependencies | Est. sessions |
|-------|------|-------------|:---:|
| **0** | Scaffold + Data Bridge | None | 1 |
| **1** | Dashboard HTML + CSS | Phase 0 | 1 |
| **2** | JS Logic + Live Data | Phase 1 | 1 |
| **3** | Time-of-Day Modes | Phase 2 | 1 |
| **4** | Kiosk Setup + 24/7 Deployment | Phase 3 | 1 |

**Total:** ~5 build sessions

---

## 2. Phase Details

### Phase 0 — Scaffold + Data Bridge

**Goal:** Data bridge runs and serves a static JSON endpoint

- [ ] Create project directory `~/projects/lifedash/`
- [ ] Set up Python virtual environment
- [ ] Install dependencies (FastAPI, uvicorn, aiosqlite, httpx)
- [ ] Create data bridge: `server.py` with `GET /api/state` endpoint
- [ ] Implement habits reader (SQLite queries for today, weekly, streak)
- [ ] Implement todo reader (parse inbox.md for top task)
- [ ] Implement OpenBook proxy (cached HTTP call)
- [ ] Implement prayer status from habit tracker data
- [ ] Create `config.toml` with paths
- [ ] **Verify:** `curl http://localhost:8765/api/state` returns valid JSON with all fields

**Gate:** Data bridge running locally, serving complete state object

---

### Phase 1 — Dashboard HTML + CSS

**Goal:** Static dashboard page that looks right on the TV

- [ ] Create `index.html` with layout structure (grid areas)
- [ ] Create dark theme CSS with Nexus palette (blue/purple)
- [ ] Style clock + date (big, prominent, top)
- [ ] Style prayer section (countdown, dot indicator)
- [ ] Style habits section (list with status icons, progress bar)
- [ ] Style reading section (book title + progress bar)
- [ ] Style todo section (one-liner)
- [ ] Style highlight section (italic, muted)
- [ ] Make everything responsive via `vw`/`vh` units
- [ ] Load Inter font
- [ ] **Verify:** Open `index.html` directly in browser — layout looks correct at 1920×1080

**Gate:** Static HTML renders perfectly at TV resolution

---

### Phase 2 — JS Logic + Live Data

**Goal:** Dashboard updates live from the data bridge

- [ ] Add fetch loop: `setInterval(fetchState, 30000)`
- [ ] Implement DOM update functions for each section (no innerHTML — use textContent + classList)
- [ ] Add loading state (skeleton placeholders)
- [ ] Add error handling per section (hide on failure)
- [ ] Add smooth transitions on content updates (CSS transitions)
- [ ] Update clock every second (browser-side `setInterval`, no server round-trip)
- [ ] **Verify:** Dashboard shows live data from all sources, updates every 30s

**Gate:** Live data flowing, clock ticks, sections hide gracefully on error

---

### Phase 3 — Time-of-Day Modes

**Goal:** Dashboard auto-switches based on local time

- [ ] Implement mode detection function (get current time + Fajr time from data)
- [ ] Morning mode layout (habits-focused)
- [ ] Day mode layout (balanced — main layout)
- [ ] Evening mode layout (highlight-focused, warm tone)
- [ ] Night mode layout (minimal clock + next prayer, dimmed)
- [ ] CSS mode classes + transitions (1.5s fade)
- [ ] **Verify:** Manually adjust system clock → modes switch correctly, transitions smooth

**Gate:** All 4 modes render correctly, transitions clean

---

### Phase 4 — Kiosk Setup + 24/7 Deployment

**Goal:** Dashboard runs 24/7 on the TV without maintenance

- [ ] Create systemd user service for data bridge (`~/.config/systemd/user/lifedash-bridge.service`)
- [ ] Create systemd user service for Chromium kiosk (`lifedash-kiosk.service`)
- [ ] Configure auto-restart on crash (`Restart=always`)
- [ ] Add `RestartSec=5` to prevent crash loops
- [ ] Test: reboot laptop → both services start, TV shows dashboard
- [ ] Set up logging (journald for both services)
- [ ] (Optional) Add health-check endpoint: `GET /api/health`
- [ ] **Verify:** System reboot → dashboard appears on TV within 30s

**Gate:** Dashboard runs automatically after reboot

---

## 3. Test & Verification Gates

| Gate | Check |
|------|-------|
| ✅ State endpoint | `curl localhost:8765/api/state` returns valid JSON |
| ✅ Layout | Dashboard at 1920×1080 — all sections visible, no overflow |
| ✅ Live data | Habits/prayers update within 30s of logging on phone |
| ✅ Mode switch | All 4 modes render and transition |
| ✅ Kiosk | Chromium fullscreen, no browser chrome visible |
| ✅ Reboot | Both services start on boot |
| ✅ Sleep/wake | Dashboard recovers without manual intervention |

## 4. File Map

```
~/projects/lifedash/
├── server.py              # Data bridge (FastAPI)
├── config.toml            # User configuration
├── index.html             # Dashboard frontend (single file)
├── requirements.txt       # Python dependencies
├── 01-PRD.md              # This document set
├── 02-TRD.md
├── 03-UX.md
├── 04-AppFlow.md
├── 05-DataSources.md
└── 06-ImplPlan.md
```

## 5. Rollback Strategy

- Each phase is a Git commit with a clear message
- Failed phase → revert last commit, fix, recommit
- Data bridge and frontend are independent — can roll back one without the other
- Config file is never auto-overwritten (manual edits survive updates)
