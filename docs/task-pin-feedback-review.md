# Task pin save feedback

October 28, 2026. Failure injection reproduced an attempted unpin returning immediately to checked, unchanged stored pinned=true, no alert and an uncaught rejection. The task-keyed TaskPin field awaits updateTask, retains attempted choice during mounted failure, gives error/Retry, disables while pending, guards repeat changes, and ignores old completion UI after switching tasks. No pin ordering or other policy change.

Six 1440/390/320 light/dark groups pass failure/retention/DB unchanged/retry/duplicate/origin/reopen. The priority suite also still passes six groups; build passes. Failed choices are component-local and lost on close, pending writes continue after navigation. No cross-tab singleton or concurrent deletion guarantee. WAI and NN/g recovery guidance from prior research remains applicable.

Actual 390 light and 320 dark pixels inspected: readable inline error and Retry, no overlap. Independent focused review passed twelve combined pin/priority groups and build. Local landing approved.
