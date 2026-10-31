# Product truth

Lifedash is a local-first personal dashboard for people who want one calm place
to decide what to do next. It brings tasks, projects, habits, goals, notes, a
journal, and a day planner into one installable app.

## Who it is for

- One person managing their own work and life, not a team.
- People who prefer owning their data over creating an account.
- People who want a daily planning surface that stays useful offline.

## The promise

Open Lifedash and know three things within a few seconds:

1. What matters next.
2. What is already committed today.
3. Whether the rest of life (habits, goals, notes, reflection) is on track.

Everything else is supporting detail. The product should feel quiet, precise,
and quick to leave.

## Principles

- **Local-first by default.** IndexedDB is the source of truth. Sync is optional
  and self-hosted. No account is required to use the app.
- **One next action.** The Home surface recommends one unblocked task instead of
  presenting a wall of equal-weight widgets.
- **Calm over clever.** Warm paper, ink, and a single teal accent. Whitespace and
  hierarchy do the work that borders and decoration usually do.
- **Progressive depth.** A short daily flow is visible immediately; projects,
  history, automations, and sync are available without crowding it.
- **Honest states.** Saving, failure, and recovery messages say what happened,
  what was preserved, and what to try next.
- **Keyboard and touch are peers.** Every primary flow works with a keyboard,
  a phone, and a screen reader.

## Surfaces

- **Home** - daily briefing: next action, today's commitments and open tasks,
  with habits and signals in a supporting rail.
- **Today / Upcoming / Backlog / Completed** - task lists by time horizon.
- **Planner / Week / Calendar** - day schedule, week load, and month overview.
- **Habits / Goals** - recurring practice and longer-horizon outcomes.
- **Notes / Journal** - reference material and daily reflection.
- **Projects** - nested task collections with progress.
- **Tools** - capture, search, import/export, automation, sync, appearance.

## Data model

Tasks belong to projects, may have subtasks, dates, times, recurrence, tags,
blockers, priorities, goals, notes, and attachments. Habits have schedules and
daily logs. Goals link to tasks. Journal entries are one per day with mood,
highlight, and rich text. Settings and widget visibility live in IndexedDB;
device preferences (theme, style, font, wallpaper) live in localStorage.

## Constraints

- The 16 visual styles must remain functional. New layout primitives use shared
  tokens so each style can express its own color, type, radius, and density.
- No schema changes are required for the interface refresh.
- Existing keyboard shortcuts, sample mode, sync, and import/export behavior
  must keep working.
- The app is a PWA and must remain usable at 320px wide and with reduced motion.

## Non-goals

- Team collaboration, shared workspaces, or social features.
- Hosted accounts or a mandatory cloud.
- Replacing a full calendar or project-management suite.
