# Combined commission tolerance: integration draft

## Approved policy

Accept independently verified USDT within +/-1 of the BASE commission total, once per original receipt/group. Example: 18.30 + 20.00 due, 38.00 received, 0.30 waived. Never rewrite the fee rate or base commission to pretend a different amount arrived. Zero/negative receipts are not accepted.

## Implemented in this draft

- The integer-micro policy now uses largest-remainder allocation. This also fixes a discovered edge case in the first draft: giving every rounding remainder to the last invoice could turn a tiny underpayment into an apparent overpayment on that invoice.
- A server-resolved, canonical-owner approval persists a specific original receipt, network, seller, exact commission membership and each frozen base amount. No caller-supplied owner ID, amount or waiver is trusted. Similarity of amounts is never treated as sender identity.
- The existing protected every-minute scanner reuses its TRC20/BEP20/Binance discovery for approved payment groups, including when no individual exact-payment candidate exists. Bounded retries rotate failed groups and preserve provider degradation reporting.
- Actual receipts are independently re-read: credited Binance internal deposits through the existing read-only adapter; canonical BSC receipts through the existing exact verifier; TRON receipts through a new pinned SolidityNode USDT verifier. The verifier proves ACTUAL received funds before applying the tolerance.
- Group commissions, accurate allocation/waiver/excess metadata, audit result, seller notification and recoverable confirmation-email markers are written in one canonical snapshot transaction. Commit-time owner, membership, per-invoice amount, unpaid/pending state and receipt-use checks prevent stale or partially applied settlement. It does not update users, sessions, listings or trade payment stages.
- A migration introduces permanent group receipt reservations and INSERT/UPDATE triggers shared by the old single-payment path. They prevent the same original receipt from being assigned to another seller/invoice, including after snapshot replacement or audit removal. Runtime refuses enabled batch processing without both database guards.
- `/api/admin/commission-batches` is owner-only; approval requires same-origin browser requests, independent payer acknowledgement, valid bounded input and rate limiting. Approval returns awaiting-verification, never a false paid status.

## Verification

34 dependency-free integration/policy tests were executed locally on Node 22.16.0 and passed, including 8,000 generated allocation cases and simulated concurrent scheduler/single-payment conflicts. These are simulated transaction tests, not live PostgreSQL concurrency evidence.

A release gate was added before the existing Vercel build. It runs the original policy suite, the new integration suite, PGlite/PostgreSQL reservation-trigger tests, TRON proof mocks, owner-route tests, scanner-wiring tests and the existing commission scanner/routing regression suites. Hosted results must be checked for the exact new commit before marking this ready. Test processes receive no production database connection or Binance receiving-account credentials.

## Rollout: disabled, draft, not a completed production release

`ALPHA_EXCHANGE_COMMISSION_BATCH_V1` must remain unset/0 until validation and review are complete. Existing exact-payment discovery is unchanged while disabled. No production customer payment, database migration or secret was changed in this continuation.

Before enabling:
1. Verify the hosted release gates, TypeScript/lint and production build on the exact branch head. Exercise repository-level concurrency and actual web/native status refresh in a safe test environment.
2. Finish the owner receipt-review UI and independent payer-evidence association flow. The API is not a finished self-service "pay all" interface. Fully automatic rounded internal transfers still need reliable sender binding; unidentified/ambiguous deposits must not be auto-assigned.
3. Apply and verify `db/migrations/20260925_commission_batch_receipt_reservations.sql` through the authorized migration process, then explicitly enable the environment flag in the intended deployment. Missing guards fail closed.
4. Verify notification/email wording, actual-received/waiver/excess reporting and the seller's commission restriction disappearing only when no dues remain. Other account restrictions must stay in place.
5. Confirm a genuine received-and-attributed payment with read-only production evidence. Never fabricate a customer deposit or ask someone to pay twice for testing.

## Existing incident

CM-000042 and CM-000043 were previously manually confirmed by the owner on 2026-09-25. This code does not re-settle or reset them. The original 38-USDT receipt must not be reused for new dues. A notification screenshot alone is not a verified transaction ID or sender binding.
