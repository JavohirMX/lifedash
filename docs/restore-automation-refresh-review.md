# Restore automation view refresh

Backup restore writes automation stores, but App kept startup rules in state. Opening Automation afterward showed stale switches and missing rules although task completion reads saved settings. Refresh state from loadRules/loadUserRules on full-restore settlement, including partial and rejected restores. No save, execution, background sync, new option or restore policy change. Ordinary task import unchanged.

UI lane candidate independently applied to72a4fc88. Eighteen Chrome cases (1440/390/320 light/dark, success/partial/rejected) compare actual stores and displayed switches/rules, unchanged task arrays, and subsequent edits preserve restored rules. Strengthened success case edits restored rule title, preserving ID/trigger/stamps. Twelve existing post-record failure cases plus eight-table roundtrip pass. 390light partial and320dark success actual pixels inspected readable.

Callback remains valid after ImportDialog closes because App owns state; not a broader cross-tab state synchronization promise.
