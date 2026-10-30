# Field display reconciliation after a save

A newer saved field value observed while a local save promise was pending was ignored and never applied after success. Sample DB probe: attempted priority 2, newer saved priority 3, settled control still 2 while DB 3.

The display now records whether live props changed while writing. After settlement it reapplies the latest saved prop only when such a change was deferred and the save succeeded. Failed choices remain available for retry. This does not change DB writes, retry patches or conflict policy. Covered fields: priority, pin, date, time, project, goal and recurrence.

A naive dependency on busy was rejected after an existing date-clear check exposed transient stale restoration. The revised deferred-only approach passes that check. Six width/theme groups each test seven fields with success and failure, plus 42 existing recovery groups, 320 tests and build. No native/cross-tab/server conflict claim; the probe delivers newer local DB updates deterministically.

Independent review accepted the bounded display-only patch, including date clearing and recovery. Fixture was strengthened afterward with new fictional project/goal destinations and a pin roundtrip on failed saves, then repeated successfully. No change in copy or layout. Latest pushed checkpoint remains 9566ce79.
