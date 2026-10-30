# Task detail focus timer feedback

October28,2026 against0cf16f01. Isolated start/stop/switch failures reproduced no alert and uncaught rejection. Failed switch rolls back the previous running row through existing repository transaction. TaskFocus now awaits existing startFocus/stopFocus, reports pending/failure beside controls, guards duplicate changes and uses a task-keyed mount guard. Clock/button/total display order and timer calculations remain unchanged. Other timer entry points are not fixed by this scoped change.

Six1440/390/320 light/dark groups cover start failure/no running row/retry; stop failure/running row retained/retry; switch failure/entire previous running row retained/retry; held transaction duplicate guard and different-task isolation.314/build pass, final six groups/build rerun after preserving original display order. Actual390-light/320-dark pixels inspected. Pending actions continue on navigation; busy/error state is mounted-only. Existing cross-tab transaction serialization remains, but UI guard does not span other timer entry points or mounts. stopFocus still acts on current running sessions, not a bound session ID. No claim that external concurrent changes are isolated.

WAI/NNg recovery guidance from prior research applies. Existing local-only focus data and JSON backup semantics unchanged.

Independent focused review passed six groups/build. Existing operations/display order preserved. Local landing approved; Home widget stop remains a separate candidate.
