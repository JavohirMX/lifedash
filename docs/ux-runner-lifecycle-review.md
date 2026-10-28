# UX runner interruption cleanup

Existing UX runner used finally cleanup on normal/error exit but installed no signal handlers, unlike keyboard runner. Add SIGINT/SIGTERM stop handler, check stop before next script, treat signal-killed child as failure, and await active child/server exit. No production app changes. No dependency/new process system.

Lifecycle regression uses a disposable probe, fixed local test port4197 and temp marker: occupied port fails before probe and doesn't reuse/stop occupant; active SIGINT and SIGTERM each reap probe, release Vite port, return nonzero. Six normal clean-service groups PASS after patch. Only tests local processes, not OS-wide termination guarantee; crashes/SIGKILL not handled. No visual effect.
