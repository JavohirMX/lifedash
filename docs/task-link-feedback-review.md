# Task project and goal save feedback

October 28, 2026, against 99595a52. Independent browser reproductions of project Homelab -> Inbox and active goal -> No goal each reverted the select silently on write rejection, DB unchanged, zero alert and one uncaught rejection. TaskLinkField now keeps failed choice in mounted task-local state, awaits updateTask, disables pending controls, guards duplicate writes, and offers explicit Retry/error. Original project tree options, active-goal filtering, archived-goal fallback, and null on No goal are preserved.

Twelve groups at 1440/390/320 light/dark pass failure/retention/unchanged DB/retry/duplicate/origin/reopen with no pageerrors or overflow. 314 tests/build pass. Actual 390-light project and 320-dark goal pixels inspected, error and Retry readable next to their field.

Limits: failed choices are component state only, discarded on close; pending writes continue after navigation. No cross-tab singleton, concurrent deletion or disappearing-option behavior is added. Project movement, goal relationship and order semantics are unchanged. No view aggregation or sync policy decision. Existing WAI and NN/g error recovery guidance applies.

Independent focused review PASS: twelve width/theme groups/build, nullable mapping exercised and original options/fallback/repository semantics preserved. Local landing approved, backup batched with next related verified field change.
