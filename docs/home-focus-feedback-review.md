# Home focus stop feedback

October28,2026. Isolated Home-widget stop rejection preserved running row, no alert and uncaught rejection. HomeFocusStop awaits stopFocus, guards duplicates while pending and reports error beside Stop for retry. Keyed by running session ID to discard old mounted error state when session changes. Existing widget calculations, stop-current-session semantics, local-only data and repository transaction unchanged.

Six1440/390/320 light/dark browser groups pass failure/unchanged running row/retry/held duplicate with no pageerrors/overflow. Build passes. Pending stop continues after navigation. No cross-entrypoint UI guard or external session-change isolation promised; stopFocus acts on current session as before.

Actual390-light/320-dark pixels inspected and corrected initial wrapper layout which squeezed title beside the error. Current component wraps original title+Stop row and puts status/error below it, preserving full title width. Six groups/build rerun after correction.

Independent focused review passed six groups/build, confirmed original title/Stop/total order and session-keyed feedback. Local landing approved. Integrated timer+repeat+skip+Home UX suites and314 tests pass.
