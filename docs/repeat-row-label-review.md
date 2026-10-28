# Truthful recurrence card labels

The task editor classified constrained rules as custom but task cards still used frequency-only text, e.g. `Daily` for DAILY+COUNT. The shared display classifier now supplies both editor choices and card labels. Shapes outside the existing basic editor controls say `Custom repeat`; basic generated labels and unreadable-rule feedback remain unchanged. No stored rule normalization, scheduling-engine change or new editing capability.

320 tests/build and 25 recurrence browser groups pass across 1440/390/320 light/dark. New row fixture verifies four custom shapes, no false interval, exact stored rule on open and explicit Daily replacement. First fixture attempt wrongly checked Home's generic metadata instead of a task-list row; corrected to navigate Today. Revised fixture passes. Desktop light and mobile dark pixels inspected, concise labels fit.

Independent review accepted the bounded row/editor display candidate. Its browser groups passed but its shell wrapper exited 1 during background Vite teardown; this is not a clean aggregate wrapper claim. Integrator browser/keyboard runs exited 0. Backend dev dependencies and three isolation/transaction tests are integrated separately. Restore checkpoint verification follows.
