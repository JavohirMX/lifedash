# Pending import controls

UI lane supplied SHA-matched patch d79271dd0587d85c89bdce579d36319d982ef8da969c2d87312ca6a81e923493 based on fb4e0664. Independently applied and checked on cb9dc5ee.

The existing request captures its source and destination at submit. Editing those while pending could show replacement text although original records were committed. Disable source file/text/format/destination while busy and invalidate earlier file-read generation when either operation starts. Closing behavior, transaction boundaries, retry actions and copy unchanged.

Independent integration checks: six 1440/390/320 light/dark groups cover import/restore locks, delayed file resolution, rejection unlock/source retention and retry success. Twelve post-commit automation failure cases and six existing rejection/retry/duplicate groups pass together. 390 light/320 dark screenshots inspected, no horizontal overflow. Native disabled controls remain readable. The existing secondary Importing label during full restore is unchanged and not a new separate operation.
