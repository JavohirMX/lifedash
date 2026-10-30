# New note save recovery

October 28, 2026. Existing New note discarded the rejected add promise with no feedback and allowed repeat clicks during a held write. It now awaits the write, disables New note while pending with a synchronous duplicate guard, opens only the successfully created note, and shows a specific error beside the unchanged New note action on failure. No title/body draft exists before creation. Note deletion and pinning are unchanged.

Six Chromium1440/390/320 light/dark groups reject the first add, verify unchanged record count and visible recovery, then hold Retry and force a duplicate click: exactly one new record is created. No page errors or horizontal overflow. This applies the same already recorded NN/g and WAI form feedback sources, with no new product policy.
