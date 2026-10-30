# Saved daily repeat interval display

Saved every7days rule previously opens interval3 from hardcoded state; browser reproduced. Initialize daily interval from existing recurrence description and refresh when saved rule changes while idle/no failed choice. Existing failed choice and held write remain untouched. No recurrence serialization/anchor/scheduling policy change. Custom weekly/monthly/imported rules still map into existing unsupported editor approximation, not solved by this patch and not converted automatically.

Sixwidth/theme mount/liveupdate/remount/failure-retain/retry groups, existing repeat semantics fixture and six repeat recovery groups317tests/build PASS. No new UI copy/layout. Screenshot shows saved7days, not new default3. Pending independent review.
