# Recorded seller facts and database regression coverage

The trust engine previously fabricated profile/listing views, monthly growth,
customer ratings and satisfaction. It converted 15% of cancelled requests into
"disputes lost", reported suspension as two violations, counted pending
requests toward successful outcomes, trusted advertised response times and
included unpaid commissions in the settled total. Six failing regression
cases reproduced these problems before the change.

Ratings now use visible completed-trade reviews; acceptance timing uses recorded
timestamps. Success and completion use actual completed requests. Active
enforcement records and account suspension are reported separately. The dispute
schema does not record a losing party, so lost-dispute counts remain unavailable.
Views and growth remain unavailable until measured. No zero is substituted for
missing measurement. Existing score weights, prestige floors and owner rank
overrides are retained; correcting their factual inputs can change trust scores.

Public listings, private profiles and owner summaries compute current facts
instead of serving the old cached estimates. The legacy `estimatedCommissionPaid`
field counts settled obligations only. It is not an on-chain cash-receipts ledger;
receipt totals and waived differences remain a separate reconciliation concern.

The new CI job uses four independent application processes and an isolated
loopback PostgreSQL 17 instance. Its fixture contains 15 sellers and 60 buyers
across the three payment methods. It checks concurrent amount adjustments,
three-active-trade limits, restarts, payment-stage progression, buyer-completion
denials, duplicate completion, inventory and commission reconciliation, and
rollback after a process dies with an open transaction. It captures actual
database overlap and direct server-action latency. Missing database access is a
failure, never an in-memory test fallback.

The harness contains no real accounts or provider credentials. Outbound HTTP is
disabled. Notification queue writes can be exercised, but external delivery,
chain payment detection, browser timing and production recovery are not certified
by this job. A successful build of the harness is not a successful database run.
