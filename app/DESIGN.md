# Lifedash design system

Mode: **Operate** (a tool you work in daily). Precision and restraint over
expression; the interface should disappear into the task. Built with the
Impeccable and Taste design-guidance packs as references.

## Foundations

- **Ground**: warm paper `#f7f7f4` (light) / true neutral `#111110` (dark).
  No navy, no slate, no saturated sidebar.
- **Surfaces**: white/#1b1b19 cards separated by 1px rules (`--rule`) or one
  tone step. A border or a shadow, never both; shadows only for floating
  layers (sheets, menus).
- **Accent**: teal `#0f766e` (light) / `#4fb3a8` (dark). On data and state
  only: completion checks, streak cells, today markers, tags, focus rings,
  the one primary action. Never on chrome (nav pills, bars, headings).
- **Status**: positive `#2b7a50`, negative `#b42318`, warning `#b45309`
  (4.5:1+ as text on their surfaces; dark-theme counterparts lifted).
- **Type**: one grotesk, IBM Plex Sans (400/500/600/700, self-hosted via
  @fontsource). Scale 12/14/16/24; h1 24px/600 with -0.02em tracking.
  Tabular figures (`font-variant-numeric: tabular-nums`) on counts, times,
  streaks.
- **Icons**: lucide-react only, 16px outline at 1.75 stroke (20px in the
  phone dock). No emoji or unicode glyphs as icons.
- **Radius**: bimodal-tight family - cards 8px, controls 6px, chips full
  pill. Nested radii step down.
- **Motion**: 160ms ease-out state transitions (hover/focus/active) only;
  no entrances or decoration; `prefers-reduced-motion` disables all.

## Shell

- Desktop: 232px labelled sidebar on the page ground, 1px hairline right
  border. Brand mark (pulse line on accent) + wordmark top. Nav rows 32px
  on a 34px pitch; active = neutral grey pill (`--active`), never accent
  fill. Counts as plain tabular grey numbers. Section labels 12px
  sentence-case. Theme + export pinned at the bottom.
- Phone (<=720px): top bar (brand + theme), fixed bottom dock with 5
  destinations (Today, Planner, Week, Habits, More); More opens a
  full-screen sheet with all destinations, projects, search and actions.
  Accent marks the active dock item.

## Components

- Task rows: white surface, 1px `--rule` border, 44px min-height, 6px
  pitch. 20px circular checkbox (1.5px `--control` border, accent fill
  when done). Hover reveals the pin action. Overdue dates in negative,
  today in warning, tags in accent, everything else grey.
- One filled-primary vocabulary: near-black `--primary-btn` where a true
  primary is needed; ghost/outline controls elsewhere. Destructive =
  negative outline, fills on hover.
- Empty states: one sentence that teaches the next step, no illustration.
- Focus: 2px accent `:focus-visible` ring; selection and caret tinted
  from the accent.

## Themes

`light | dark | system` via the sidebar/dock toggle, persisted in
localStorage (`lifedash-theme`), applied to `<html data-theme>` before
render; `color-scheme` follows so native controls (date inputs, scrollbars)
match. `theme-color` meta tracks both themes.
