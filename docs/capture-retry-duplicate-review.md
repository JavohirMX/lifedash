# Failed capture same-turn retry guard

Reproduced two synchronous Retry save clicks on same failed capture create two tasks. Guard existing retryingCaptures job identity set before queueing, unchanged parsing/new-capture submission policy. One-line production change. Duplicatefixture beforecount2, aftercount1 and one add call PASS; six failed capture navigation/reject/heldretry/successrelease and six existing capture recovery groups317tests/build PASS. Pending review. No native or durable/external duplicate guarantee.
