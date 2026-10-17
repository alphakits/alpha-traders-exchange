# Trade acceptance account scope and latency

Reliability Shield #1034 recorded 240 successful business-engine actions, but 15 exceeded the unchanged one-second gate. Every slow action was acceptance. The maximum was 1203.578 ms; p95 was 1034.553 ms. The slowest action spent 1196 ms in the database-read phase, including connection/lock waiting, and 5 ms writing. All 30 correctness and three isolated restoration checks passed. The failure is retained; it is not reclassified or rerun away.

Acceptance was loading all account payloads while holding the canonical financial transaction lock. Completion already limited its account projection. Acceptance now uses that same dependency scope: the caller, both target participants, every counterparty in the seller's or buyer's related requests, and every admin/owner recipient, including the canonical owner-email rule. Unnumbered legacy requests still retain the complete request dependency collection. Other lifecycle states retain their existing account scope.

The global mutation lock, request lock, canonical re-read, inventory/capacity rules, account eligibility checks, commit boundary, write allowlist, and strict performance threshold are unchanged. Lifecycle actions still cannot write the users table.

The actual PostgreSQL query regression runs in PGlite and failed before the optimization because acceptance included an unrelated account. It verifies disabled callers, related counterparties, role-array administrators, legacy owner email, unchanged stored rows, and the account-write prohibition. The existing independent-process PostgreSQL harness now also checks the exact acceptance account/request IDs before its unchanged 240 timed actions. The harness uses synthetic loopback data only.

The final hosted timing result is recorded with the exact candidate in the audit report. A passing isolated sample does not establish stable production browser/provider latency or erase the earlier #1024 and #1034 misses.
