# Automation settings save feedback

Rejected localStorage rule write reproduced checked toggle true, no stored rules, uncaught errors and no alert. App now saves existing rule values before updating rendered state. Dialog catches synchronous save failure, preserves form/list/toggle and offers same-action retry. Add/edit only reset draft on saved success; delete failed stays listed. Default false/opt-in/triggers/ids/createdAt/lastFired unchanged. No automation engine edits.

Six1440/390/320light/dark complete-parent toggle/add/edit/delete write rejection/retry PASS,315tests/checked-exit build PASS.390light/320dark inspected readable alert/draft. Immediate rollover execution remains existing asynchronous separate path; no rollback or execution-failure handling claimed. Settings save catch does not swallow async rollover rejection. Failure notice is mounted dialog state, no persistence/global cross-tab lock. Source-of-truth here localStorage write success.
