# Workflow UX review

October 27, 2026. Local development candidates, not a user study or a deployment-readiness certificate.

The refinement keeps the task-first Home layout and existing calculations. It makes scope, next actions and smaller-screen paths clearer. It does not settle data policies, change sync conflict handling or connect a real calendar account. Font comparisons remain choices for review; the default is unchanged.

## Source-to-change notes

| Reference | Pattern used | Lifedash change |
| --- | --- | --- |
| [Vikunja dashboard](https://vikunja.io/help/dashboard/) | Quick capture and due-date-oriented overview | Keep capture and focused work prominent, with clear full-list paths |
| [Vikunja filters](https://vikunja.io/help/filters/) | Make scope understandable | Explicit Today/Upcoming/Backlog/project/Calendar scope; preserve project choices while filtering search |
| [NN/g progressive disclosure](https://www.nngroup.com/articles/progressive-disclosure/) | Primary actions visible; details discoverable | Visible Add habit/Cancel and Add goal/Cancel; Calendar day details; full-list preview links |
| [NN/g complex application design](https://www.nngroup.com/articles/complex-application-design/) | Reduce clutter without removing capability | Short workflow guidance; phone Notes list/editor with a return path, desktop split view retained |
| [NN/g dashboards](https://www.nngroup.com/articles/dashboards-preattentive/) | Clear at-a-glance meaning | Visible chart counts/date range and accurate completion scope |
| [Homepage widgets](https://gethomepage.dev/widgets/) and [services](https://gethomepage.dev/configs/services/) | Group related information and distinguish configurable parts | Keep Home widgets configurable without mixing configuration into primary work |
| [Vikunja overdue discussion](https://community.vikunja.io/t/overdue-tasks-persistance/2733) and [overview discussion](https://community.vikunja.io/t/purpose-of-the-overview-page-and-tasks-that-matter-today/3603) | Individual reports about overview clutter and focus | Preserve today's focused work rather than adding more undifferentiated modules |

The official sources describe product patterns, not popularity or proof that they work for every Lifedash user. NN/g provides general usability guidance. The forum reports are anecdotal. No source establishes a universal preferred default or replaces testing with the intended user.

## Page and task-path review

- Home: exact counts/date scope, full-list navigation, widget controls, touch completion and habit check-in.
- Today, Upcoming and Backlog: clarify overdue, future horizon and undated scope. Scheduling path remains available without dragging.
- Planner and Week: explain drag versus opening a task on touch devices; retain existing time and aggregation behavior.
- Calendar: explicitly includes top-level completed tasks; selected day reveals its full list and scrolls into view. No calculation changes.
- Habits: visible create/cancel controls; unique two-letter weekdays plus full accessible names and pressed states. Verified six-day schedule persistence.
- Goals: visible create/cancel controls and explanation of task linking versus marking the goal done.
- Notes: autosave/pinning guidance; phone selection opens the editor with Back to notes, desktop split view retained. Saved text read back from IndexedDB.
- Journal: date-navigation/autosave guidance; mood persists across previous-day and Today navigation.
- Search: project options no longer collapse after choosing one project, allowing a direct switch to another matching project.
- Projects: disclose subproject and progress scope without changing it.
- Completed, task details, import/restore, Automation, on-device planner and TV: rendering/basic navigation review. Existing restore metadata-only caveat retained. This is not an exhaustive semantic or accessibility audit.
- Settings/appearance and self-host setup have their own notes in `appearance-ux.md` and `server/SELFHOST.md`.

## Validation and limits

From `app/`, `node scripts/run-ux-checks.mjs` starts an isolated loopback Vite server and runs fictional-data checks for settings return paths, appearance, fonts, wallpaper, Home, habit creation and remaining routes/dialogs. `node scripts/page-workflows-smoke.mjs` independently checks Calendar, goal creation, Notes persistence/back, Journal navigation and desktop search-project switching. These checks use 1440, 390 and 320 px widths, with light/dark page coverage. Screenshots were inspected for representative desktop/phone surfaces; passing no-overflow checks alone is not treated as design approval.

Unit tests, production build and keyboard tests are separate checks. Browser checks are headless Chrome, not real-device testing, whole-app accessibility conformance, a usability study or confirmation of every edge case. TV's existing Due today label includes overdue tasks; its policy remains unchanged pending a product decision. Docker, TLS, cross-device sync and real Google/Apple/Outlook calendar import remain unverified. Manual ICS export is not live sync; the optional feed development patch is kept separate and disabled, not part of accepted runtime.
