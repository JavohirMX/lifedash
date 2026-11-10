# Lifedash design system

**Calm precision.** A quiet daily instrument: warm paper, ink, one teal accent,
and enough structure to decide what matters next. The interface should feel
considered rather than decorated, and should get out of the way quickly.

Built with the Impeccable and Taste design-guidance packs as references.

## Foundations

### Color

- **Ground**: warm paper `#f7f6f2` (light) / near-black `#121211` (dark).
- **Surface**: white / `#1b1b19`, separated by a hairline (`--border`) or one
  tone step. A border or a shadow, never both. Shadows belong to floating
  layers only.
- **Ink**: `#1b1c18` text, `#5f6159` muted, `#7c7e75` faint. Dark counterparts
  are lifted, never pure white.
- **Accent**: teal `#0f766e` light / `#5ab8ad` dark. Used for state and action:
  completion, today, streaks, focus, links, and the one primary button. Never
  as navigation chrome or a decorative wash.
- **Status**: positive `#2b7a50`, negative `#b42318`, warning `#b45309`.
  Status colors are reserved for meaning, not emphasis.
- **Paper warmth is intentional.** Do not drift to blue-grey or navy.

### Type

- **Display and UI**: Instrument Sans (variable, self-hosted). Fallback:
  `ui-sans-serif, system-ui`.
- **Data and annotation**: IBM Plex Mono (400/500, self-hosted) for dates,
  times, counts, streaks, and small metadata. Never for body copy.
- **Scale**: 12 / 13 / 14.5 / 17 / 21 / 30 / 38. Body 14.5px, line-height 1.55.
  Page titles 30-38px, weight 600, tracking -0.03em. Section titles 17px/600.
  Eyebrows 11px/500, uppercase, tracking 0.08em.
- **Reading measure**: 68-72 characters for prose. Task titles may run longer
  but wrap rather than truncate on the Home surface.
- **Figures**: tabular numerals on every count, time, duration, and streak.
- **Font choice**: the default preference is **Match style**, so Paper renders
  Instrument Sans and other styles render their own typography. Explicit font
  choices remain available and pinned across styles.

### Space and shape

- Spacing scale: 4, 8, 12, 16, 20, 24, 32, 40, 56, 72.
- Page rhythm: 32-40px between major sections, 12-16px inside groups.
- Radius: cards 10px, controls 7px, panels 14px, chips full pill. Nested radii
  step down. Other styles may override via tokens.
- Borders: 1px `--border`; internal rules use `--rule`. Avoid borders on every
  row; use spacing and alignment first.

### Motion

- 160ms ease-out for hover, focus, and state changes.
- No entrance animation, parallax, or decorative movement.
- `prefers-reduced-motion: reduce` disables transitions globally.
- Focus rings are 2px accent with a 3px offset; never remove them.

### Icons

Lucide only, 16-18px at 1.75 stroke (20px in the phone dock). No emoji or
unicode glyphs as interface icons.

## Layout

Three widths, chosen by the job:

- **Reading** (`720px`): Journal editor, notes, long-form settings.
- **Standard** (`880-1120px`): task lists, habits, goals, search.
- **Planning** (`up to 1400px`): Planner, Week, Calendar, Home.

The content column is centered in the remaining viewport, with a minimum of
24px inline padding and 32-56px on wide screens. Mobile uses 16px inline
padding plus safe-area insets.

Page header pattern:

```
eyebrow (optional)     actions
Title                  meta
Supporting sentence
```

Titles are left-aligned. Actions sit on the title baseline on desktop and wrap
below on narrow screens. Supporting copy is one sentence, muted, max 70ch.

## Shell

### Desktop

- 244px labelled sidebar on the page ground, 1px hairline right border.
- Brand mark + wordmark at the top, then capture and search.
- Navigation is grouped: Start, Plan, Track, History. Rows are 34px on a
  36px pitch; active = neutral `--active` pill, never accent fill. Counts are
  plain tabular numbers.
- The navigation column scrolls independently; **Tools and Settings are pinned
  to the bottom** and never fall below the fold.
- The main region scrolls with the page. No nested page scrollbars.

### Phone (<=720px)

- Sticky top bar: brand, capture, search, appearance.
- Fixed bottom dock: Home, Today, Planner, Habits, More. Accent marks the
  active destination.
- More opens a solid, full-height sheet over a dimmed backdrop. Body scroll is
  locked, safe areas are respected, focus is trapped, and Escape returns focus
  to More.
- Detail panels become full-screen sheets with a clear close action.

## Components

### Task rows

White surface, 1px `--rule`, 44px minimum height, 6px gap. A 20px circular
checkbox with a 1.5px control border; accent fill when done. Hover reveals pin
and secondary actions. Overdue dates use negative, today uses warning, tags use
accent, everything else muted. Titles wrap on Home and truncate in dense lists.

### Home daily briefing

1. **Header**: date eyebrow, greeting, "One thing at a time", one sentence of
   orientation, customize action.
2. **Next action**: a single soft accent panel with reason, title, complete,
   start focus, and open. This is the visual anchor.
3. **Today**: schedule followed by open tasks in one continuous flow,
   with a link to the full list.
4. **Supporting rail**: habits, needs attention signals, goals, week load, upcoming.
5. **More insights**: week chart, goals, and upcoming folded into a disclosure
   so the daily surface stays calm.

The hero remains `.home-primary .home-focus`; the commitment remains
`.home-commitment` with the accessible name "Today's schedule"; signals remain
`.home-signals` with the accessible name "Needs attention".

### Buttons

- Primary: near-black fill (`--primary-btn`) or accent where the action is
  genuinely the next step. One primary per region.
- Secondary: surface with a 1px control border.
- Quiet: text-only with an icon; used for navigation and tertiary actions.
- Destructive: negative outline, fills on hover/confirm.
- Minimum target 44px on touch; 36-40px on desktop.

### Empty states

One sentence that teaches the next step. Optional single icon. No illustrations,
no fake data, no exclamation marks.

### Dialogs

Shared overlay and panel shell: dimmed, slightly blurred backdrop; solid panel
with 14px radius and a floating shadow; 24px padding; a header with title and
close; content scrolls inside the panel; footer actions align right. Escape
closes, focus is trapped, and focus returns to the opener.

## Themes

`light | dark | system` persisted in `localStorage` (`lifedash-theme`) and
applied to `<html data-theme>` before render. `color-scheme` follows so native
controls match. `theme-color` meta tracks both themes.

All 16 styles share the token contract: `--ground`, `--surface`, `--surface-2`,
`--border`, `--rule`, `--text`, `--muted`, `--faint`, `--accent`,
`--accent-soft`, `--accent-ink`, `--primary-btn`, `--radius-card`,
`--radius-control`, `--font`, `--font-display`, `--font-mono`, `--fs-*`,
`--row-h`, `--shadow-*`. Layout primitives must not hard-code Paper colors or
radii. Style-specific overrides may change expression, not structure.

## Accessibility

- WCAG AA contrast for text and controls in both modes.
- Visible focus on every interactive element.
- Semantic headings in order; one h1 per view.
- Landmarks: `nav`, `main`, `aside` for task detail.
- Dialogs use `role="dialog"`, `aria-modal`, labelled titles, and focus traps.
- Live regions for saving, failure, and recovery states.
- Touch targets at least 44px on phone; no hover-only actions.
- Reduced motion respected; no information conveyed by color alone.
