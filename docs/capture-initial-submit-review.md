# Initial capture input consumption

Two synthetic same-turn form submits reused the same React title closure and saved two tasks. A mirrored input ref is now consumed synchronously on valid submit. New typing can create another capture, including intentionally identical words. Invalid parsed names are not consumed. No title-based deduplication policy, queue or retry change.

Independent review accepted on exact fb1e baseline: triple submit consumes one input, distinct and newly typed identical captures remain independent, invalid text remains editable, failures produce one retry draft, failed retries restore once and successful retries save once. Existing capture recovery/navigation tests, 320 tests and build pass. No actual OS IME or route-change timing claim.
