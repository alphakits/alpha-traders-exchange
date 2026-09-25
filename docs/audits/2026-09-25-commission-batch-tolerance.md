# Combined commission tolerance: development status

## Owner-approved policy

Accept a verified USDT receipt within 1 USDT below or above the BASE commission total being settled. The allowance applies once to a payment group, not once per commission. Example: 18.30 + 20.00 owed, 38.00 received, 0.30 waived. Preserve fee rates, original commission amounts, actual receipt, allocation, waived shortfall and any excess separately. Zero/negative payments must never clear a commission.

## Implemented in this change

`src/lib/commission-batch-policy.ts` provides a pure, fail-closed settlement planner. It requires an explicit receipt-to-seller attribution and a specific commission group. It rejects amount-only guesses, used references (including case/prefix aliases), wrong sellers/networks, partially settled groups, pending individual payments, changed balances, old/future receipts and out-of-tolerance amounts. Integer-micro proportional allocation conserves actual received funds and the single allowed adjustment.

`node --experimental-strip-types --test scripts/check-commission-batch-policy.mjs` passed 32 tests locally on Node 22.16.0, including 1,001 allocation cases. This is policy testing, not provider, database-concurrency, browser, native-app or production end-to-end verification.

## Not deployed / not yet integrated

This module does not change production matching or mark any real commission paid. Do not describe this draft as live automation. No production ledger, cron, wallet secret, fee rate or trade logic is modified by this change.

Before enabling the policy:

1. Implement persisted payment groups and trustworthy attribution. A shared wallet amount within +/-1 is NOT proof of which seller paid. Binance internal receipts may lack sender identity. Exact unique payment intents can retain automatic matching; approximate/unattributed deposits require an owner receipt association or independently verified payer binding. A caller-supplied owner ID or receipt object is not an authentication check.
2. Independently verify credited receipt, canonical destination, USDT token, correct network, issuance time and existing finality checks. Preserve original chain references across Binance and blockchain scans. Re-read private Binance receipts from authenticated receiving-account history; do not turn a public receipt into a second internal alias.
3. Settle all group commissions and reserve the receipt in ONE canonical transaction under the existing shared repository lock. Revalidate payer authorization, group membership, amounts, unpaid state, individual pending attempts and receipt uniqueness inside the commit, including races with the legacy single-payment path. Do not mutate base commission amounts to force the old verifier to pass.
4. Persist receipt/allocated amount, waived shortfall, overpayment and audit evidence separately. Keep idempotent notification/email delivery recoverable. Recalculate outstanding dues after commit and remove only commission restrictions when no dues remain; other seller restrictions and active trades remain unchanged.
5. Integrate bounded retries with the existing every-minute TRC20/BEP20/Binance scanner. Surface received-but-unmatched payments, ambiguity and provider degradation honestly. Never ask a seller to pay twice to repair attribution. Verify the same backend outcome on web and native app.
6. Run provider mocks, atomic concurrency/idempotency tests, existing commission/security suites, TypeScript/lint/build and a production read-only verification before claiming release. No fake customer deposit may be introduced as a test.

## Incident preservation

A live read during this investigation showed CM-000042 and CM-000043 had already been manually confirmed by the owner at 14:26:33 and 14:26:17 UTC on 2026-09-25. The seller had no remaining unpaid commissions in that read. This change does not re-settle, reset or claim automatic credit for those records. Their original deposit must not be reused for future dues. Do not infer a verified transaction ID from a push-notification screenshot.
