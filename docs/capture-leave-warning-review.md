# Failed capture leave protection

Reproduced failed QuickAdd capture retained in page-session map but navigation to Journal removes mounted leave guard. Move guard to module lifetime; retain protection during retry write using small in-flight retry set until success/failure settles. Existing failure map clears for retry UI as before. No change to parsing, saved task contents, queue order, database/storage, initial pending new captures or UI copy. Synthetic beforeunload proves handler cancellation, not native browser prompt delivery. Session only, no durable/reload recovery claim.

Six1440/390/320lightdark failed/navigation/heldretry/successrelease groups and existing sixcapture recovery groups PASS,317tests/build PASS. Pending reviewer. No visual UI changes.
