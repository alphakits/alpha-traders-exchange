# Empty push receipt scan reuse

CI1109 on seller receipt SMS candidate 923a56c5 failed the unchanged 1000 ms
maximum action gate: 4 of 240 successful actions exceeded the threshold,
maximum 1024.965755 ms, p95 877.006473 ms. All database correctness and recovery
checks passed. This failure remains evidence; it is not waived or rerun.

The payment phase recorded 227 mobile_push_deliveries selects (129.057 ms
cumulative). Completion calls waited mostly in the read/lock path. This does
not establish that receipt scans caused all latency, but they borrow from the
same five-connection pool and can repeat after every notification.

Reuse a confirmed empty receipt scan for at most one second per pool and
process, using a monotonic clock. Continue coalescing in-flight scans. Failed
or nonempty scans remain immediately retryable. Canonical notification reads,
new notification sends, delivery claims, financial locks and durability are
unchanged. Newly eligible receipts may wait for the next notification after
the one-second window; receipt checking was already opportunistic and begins
15 minutes after sending. This introduces no background timer or guarantee of
provider delivery.

Before/after regression: 20 overlapping publications followed by 21 sequential
publications within the window previously performed 22 receipt scans; the
change performs one. At 1000 ms another scan runs. A database failure retries
immediately. A receipt becoming eligible after an empty scan is recovered at
expiry, and a missing provider receipt retries without an empty-result delay.
All 23 focused push checks across five suites pass. PostgreSQL latency,
browser and full release acceptance remain subject to the unchanged CI gates.
