# Manual owner commission retry protection

The manual assignment endpoint previously generated a fresh commission ID for
every request. Two controlled regressions reproduced duplicate debts on repeated
or concurrent requests and acceptance of changed terms under the same operation.

The dashboard now includes its persisted owner-operation UUID in a manual
commission request. The server requires that UUID, binds the durable record ID
to the authenticated actor, and stores a hash of the normalized assignment.
Repeated identical operations return the committed obligation. Conflicting
terms receive HTTP 409. Authorization is checked again before returning it.
Canonical repository locking prevents two application instances from creating
two debts, audit entries or notification rows. Only a publication actually
present in the committed snapshot may be emitted after a replay.

Retries preserve paid status and the original due date, including after that
date passes. Stale maintenance cannot remove the operation identity. Existing
manual records remain payable. A deliberately new owner action receives a new
operation ID. The existing manual amount-entry rule (0.01–1,000,000 USDT at two
decimal places, with a reason) is separate from trade-generated 1% calculations.
This repair does not establish historical approval for that manual-entry limit.

The isolated PostgreSQL gate includes eight concurrent copies of one manual
assignment across four independent processes, a changed-terms rejection, and a
retry after process termination/restart. Test results must be read from the
actual CI evidence; this document does not assert that a pending run passed or
that production was changed.
