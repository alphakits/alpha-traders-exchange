# Seller receipt SMS atomicity

D96: uploading seller USDT evidence can advance the trade to `usdt_sent` and
queue a buyer SMS in memory. The receipt transaction previously selected
payment tables without `sms_deliveries`, so the notification intent was not
durable alongside the receipt and lifecycle transition.

The seller auto-confirmation path now includes the existing SMS outbox in the
same database transaction. Buyer payment uploads retain their existing write
scope. SMS provider delivery remains asynchronous; this change persists its
intent and does not send a message inside the transaction.

The production-mode PGlite regression fixture on merged baseline
`1dcbf6334de204976beb69b3d5f30243f70f74f9` reproduced three failures in four
checks: missing intent, missing rollback on an injected outbox write failure,
and a lost new intent when another writer had already queued a message.
Lifecycle conflict rejection already passed. Five checks pass after the fix,
including a buyer upload with an unavailable SMS write path, exact receipt
bytes, rollback/retry, one intent on exact retry, and preservation of another
writer's queued message. No test sends real SMS.

The four focused suites pass all 67 tests, including SMS delivery, trading
transactions and preservation of other listing data. TypeScript, changed-file
lint and whitespace checks pass.

This extracts the atomicity correction from draft PR417. It does not include
that draft's read-scope, fallback-mirroring, evidence-batching or history-write
optimizations. It retains the seller-limit repairs already released by PR418.
Full CI and release outcomes are recorded in the pull request and saved audit.
Actual provider delivery and historical commission provenance remain separate
acceptance requirements.
