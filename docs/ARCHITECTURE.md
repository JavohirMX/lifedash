# LifeDash - Architecture Decision

**Status:** Decided (owner said "choose what's best", 2026-10-20) | **Date:** 2026-10-20

## Decision

**TypeScript + React, one codebase, three thin wrappers:**

| Target | How |
|--------|-----|
| Web | Vite PWA (installable, offline) - this is the core app |
| Desktop (macOS, Windows, Linux) | Tauri shell around the same web app |
| Mobile (iOS, Android) | Capacitor shell around the same web app |

**Data layer:** local-first. IndexedDB via Dexie in MVP - it runs in every
target's webview (browser, Tauri, Capacitor), so one data layer covers all six
platforms with zero native code. Swap-in SQLite later only if profiling demands.

**Sync (Phase 4):** small self-hosted server (FastAPI + SQLite/Postgres) on the
homelab, single user, conflict strategy: last-writer-wins per field with
tombstones. Not needed for MVP.

**Rich text (Phase 2):** TipTap (ProseMirror). **Recurrence:** rrule.

## Alternatives considered

**Flutter.** True single codebase, all six targets, excellent native
performance. Rejected: the rich-text/editor ecosystem is thinner (flutter_quill
vs TipTap), the team workflow is AI-assisted coding which is strongest in
TS/React, web builds are canvas-heavy, and the owner works in Python/JS
ecosystems. Also harder to verify iteratively in a constrained build sandbox.

**React Native + Expo (+ separate desktop).** Great mobile, but desktop/web
would drift into a second UI stack; more surface area than Tauri+Capacitor
wrapping one React app.

**Electron instead of Tauri.** Heavier (bundles Chromium); Tauri uses the OS
webview and produces small binaries. WebView2 dependency on Windows accepted.

## Consequences

- The web PWA is not a second-class port: it IS the app. Desktop and mobile are
  packaging, so features ship everywhere at once.
- Platform-specific work is limited to: notifications, file system access,
  share targets, and app-store packaging (Phase 4).
- IndexedDB holds real limits (storage eviction pressure on some platforms);
  Phase 4 must add `navigator.storage.persist()` requests and export/backup so
  local data is never the only copy.

## Verification plan (per phase)

- Unit tests: Vitest (data layer, recurrence, dependency logic).
- Browser: real-browser runs with screenshots at desktop and mobile widths
  before a UI PR is called done.
- Desktop/mobile shells: built and smoke-tested in Phase 4, documented per OS;
  anything not run on real hardware is labeled unverified in the PR.
